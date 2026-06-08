# Gateway 缓存命中观测与重复大请求保护计划

## 背景

2026-06-07 观察到 Gugu Managed 的缓存命中率从之前常见的 93%+ 降到约 84.9%。

当天截图数据：

- 输入命中缓存：3,415,936 tokens
- 输入未命中缓存：607,453 tokens
- 输出：34,924 tokens
- 命中率：`3,415,936 / (3,415,936 + 607,453) = 84.9%`

排查生产 `usage_events` 后发现：

- 607,453 的未命中输入基本都来自同一个 device 的 `message/deepseek-v4-pro`。
- 其中有两组大输入重复出现：
  - 165,642 input tokens 出现 2 次，其中 1 次 `streamCancelled`。
  - 110,305 input tokens 出现 2 次，其中 1 次 `streamCancelled`。
- 两个取消流合计约 275,947 input tokens。若先排除这些取消后又重试的大输入，命中率会从约 84.9% 回升到约 91.2%。

结论：这次低命中率不像是全局缓存系统突然失效，更像是少数超大请求在流式取消、恢复或重试链路里被重复打到上游，放大了未命中输入。

## 目标

1. 让 gateway 能看清真实缓存命中/未命中原因。
2. 减少同一设备、同一模型、同一大请求在短时间内重复打上游。
3. 不在服务器保存用户 session、messages、正文、附件内容。
4. 不明显增加 gateway 压力。

## 非目标

- 不把用户完整会话迁到 gateway。
- 不持久化 request body、messages、tool result、附件内容。
- 不改变桌面端本地 session 存储模式。
- 不在第一版做复杂队列、断点续传或服务端长会话恢复。

## 优化一：补齐缓存遥测

### 为什么做

目前 gateway 的 usage 记录主要存了：

- `input_tokens`
- `output_tokens`
- `metadata`

但是没有明确记录上游返回的 cache hit / cache miss 细分字段。因此当用户反馈“命中率下降”时，只能通过外部平台截图和总量反推，无法从 gateway 自身判断：

- 是 prompt prefix 漂移导致缓存失效？
- 是新 session / 新模型导致冷启动？
- 是附件、skills、MCP tools 变化导致前缀变了？
- 还是同一个大请求取消后重试，重复产生 miss？

补齐遥测本身不能直接减少服务器压力，但开销极小，只是在已有 usage metadata 里多写几个数字。它能避免后续排查靠猜。

### 要做什么

在 gateway 的 usage 提取和写入链路里补充以下字段，优先写入 `usage_events.metadata`，不急着改数据库 schema：

- `cache_read_input_tokens`
- `cache_creation_input_tokens`
- `prompt_cache_hit_tokens`
- `prompt_cache_miss_tokens`
- `prompt_tokens_details.cached_tokens`

兼容不同上游命名：

- Anthropic 风格：
  - `cache_read_input_tokens`
  - `cache_creation_input_tokens`
- OpenAI / DeepSeek 风格：
  - `prompt_tokens_details.cached_tokens`
  - `prompt_cache_hit_tokens`
  - `prompt_cache_miss_tokens`

建议统一归一成：

- `cacheHitInputTokens`
- `cacheMissInputTokens`
- `cacheTelemetrySource`

同时保留原始字段快照中的安全数字字段，方便回查。

### 实现建议

- 扩展 gateway 里的 usage extraction 函数，让它返回 cache hit / miss。
- SSE 流式统计时，cache 字段和 input/output 一样按最终 usage 或 max 值合并，避免中间 chunk 重复累计。
- `recordUsageTokens` 写 metadata 时带上 cache 字段。
- 不记录 request body，不记录 messages。

### 验收

- 非流式响应：能从 metadata 看到 cache hit / miss。
- 流式响应：最终 usage metadata 不重复累计。
- 没有 cache 字段的上游响应：保持兼容，不报错。
- 查询某天 usage 时，可以按 model/device 聚合出 gateway 侧 cache hit / miss 分布。

## 优化二：重复大请求保护

### 为什么做

生产数据里看到同一 device、同一模型、同一超大输入在短时间内出现“streamCancelled 后又来一次完整请求”的模式。这会带来三个问题：

1. 上游压力翻倍：同一份大 prompt 被重复发送。
2. 成本放大：取消的流虽然没有完整输出，但输入 token 已经消耗。
3. 命中率被拉低：重复冷输入会让 miss 看起来异常高。

这一步是真正可能减轻服务器和上游压力的优化。

### 核心原则

只保存短期请求指纹，不保存正文。

指纹建议：

```text
sha256(deviceId + model + normalizedRequestBody)
```

其中 `normalizedRequestBody` 只用于计算 hash，不落盘、不写 metadata 明文。

Redis value 只存：

- `status`: `active` / `cancelled` / `completed`
- `startedAt`
- `updatedAt`
- `requestBytes`
- `inputTokens` 如果已知
- `usageEventId` 可选

TTL 建议：

- active：2-3 分钟
- cancelled：30-60 秒
- completed：30-60 秒

### 第一版保护策略

建议先保守做，只保护明显的大请求：

- request body 超过阈值，例如 512 KB 或 1 MB。
- 或预估 input tokens 超过阈值，例如 50,000 tokens。
- 同一 device + model + fingerprint 在短时间内重复出现。

处理逻辑：

1. 请求进入 gateway 后计算 fingerprint。
2. Redis 中如果没有记录，则写入 `active`，正常转发。
3. 如果已有同 fingerprint 的 `active`：
   - 返回友好错误或 429，提示“相同大请求正在处理中，请等待当前请求完成或稍后重试”。
   - 不再转发给上游。
4. 如果已有同 fingerprint 的 `cancelled` 且距离取消很短：
   - 对自动重试类请求进行抑制。
   - 对用户明确重新发送的请求可以允许，但需要看桌面端是否能区分。
5. 上游完成后更新为 `completed`。
6. 客户端断开或流中断后更新为 `cancelled`。

### 更稳妥的分阶段方式

如果担心直接拦截影响体验，可以分两步：

#### Phase A：只观测，不拦截

- 记录 fingerprint 到 usage metadata。
- Redis 统计短时间重复次数。
- 不阻断请求。

验收 1-2 天后确认重复大请求确实存在，再开启拦截。

#### Phase B：开启大请求拦截

- 只对超过阈值的大请求启用。
- 只对同 device + model + fingerprint 的短时间重复启用。
- 小请求不拦截，避免误伤普通聊天。

## 对服务器压力的影响

### 缓存遥测

压力影响极小。

增加的是几个数字字段的解析和 metadata 写入，不会增加上游请求量，也不会引入服务端 session 存储。

### 重复大请求保护

预期能降低压力。

代价是每个大请求多一次 Redis get/set，以及一次本地 hash 计算。相比几十万 token 的上游请求，这个成本很小。

收益是可以避免同一大请求在取消、恢复、自动重试时重复打上游，尤其适合当前“内测用户少，但单个请求很大”的阶段。

## 安全与隐私要求

- 禁止保存用户 messages。
- 禁止保存 request body。
- 禁止保存附件内容。
- 禁止保存工具结果正文。
- fingerprint 只能是 hash。
- metadata 里只能出现 token 数、状态、hash、耗时、模型、错误类型等诊断字段。
- 查询日志时避免打印 env、API key、支付信息。

## 建议测试

### 单元测试

- JSON response usage cache 字段归一化。
- SSE response usage cache 字段归一化。
- 缺少 cache 字段时兼容。
- 相同大请求 fingerprint 一致。
- 不同 model / device / body fingerprint 不同。

### 集成测试

- 同一大请求并发两次，第二次不打上游。
- 小请求重复发送不被拦截。
- 流式请求正常完成后状态变为 completed。
- 流式请求客户端断开后状态变为 cancelled。
- Redis 不可用时 gateway 不崩溃，可降级为只记录或跳过保护。

### 生产验证

上线后看这些指标：

- 当日 `streamCancelled` 事件数。
- 取消事件的 input token 总量。
- 同 fingerprint 重复次数。
- 被保护拦截的大请求次数。
- cache hit / miss 分布是否能从 gateway metadata 还原。
- 用户是否出现“明明点了运行但被错误拦截”的反馈。

## 推荐落地顺序

1. 先做 cache telemetry，补齐观测。
2. 再做 duplicate fingerprint 记录，只观测不拦截。
3. 观察 1-2 天，确认重复大请求模式。
4. 最后开启大请求短 TTL 拦截。

这样风险最低：第一步和第二步几乎不影响用户体验，第三步拿数据，第四步才真正减压。

## 2026-06-07 实施进度

已完成 Phase A/B 的低风险观测版，尚未开启重复请求拦截。

代码变更：

- `src/index.ts`
  - `extractUsageTokens` 已归一化 cache telemetry：
    - Anthropic 风格：`cache_read_input_tokens`、`cache_creation_input_tokens`
    - OpenAI / DeepSeek 风格：`prompt_tokens_details.cached_tokens`、`prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`
  - `usage_events.metadata` 会写入：
    - `cacheHitInputTokens`
    - `cacheMissInputTokens`
    - `cacheTelemetrySource`
    - `cacheUsageRaw`
  - SSE 流式 usage 按 max 合并 cache/input/output 数字，避免 chunk 重复累计。
  - 新增 duplicate large request observation：
    - 仅对超过阈值的大 message request 计算 fingerprint。
    - fingerprint 使用 `sha256(deviceToken, model, stableJsonBody)`。
    - 不保存 request body、messages、附件内容或工具结果正文。
    - Redis 可用时写短 TTL 状态：`active`、`completed`、`cancelled`。
    - Redis 不可用时降级为 metadata-only observation，不影响请求。
  - admin metrics 新增 `duplicateLargeRequests` 快照，显示 enabled/backend/fallbackActive/threshold/TTL/observed/duplicates/redisErrors。
- `src/config.ts` / `src/types.ts`
  - 新增观测配置：
    - `GUGU_DUPLICATE_MESSAGE_REQUEST_OBSERVE_ENABLED`，默认 `1`
    - `GUGU_DUPLICATE_MESSAGE_REQUEST_MIN_BYTES`，默认 `524288`
    - `GUGU_DUPLICATE_MESSAGE_REQUEST_ACTIVE_TTL_MS`，默认 `180000`
    - `GUGU_DUPLICATE_MESSAGE_REQUEST_SETTLED_TTL_MS`，默认 `60000`
- `.env.example`、`deploy/env/gateway.env.example`、`deploy/docker/gateway.sandbox.env`
  - 已补充上述配置示例。

测试覆盖：

- JSON 响应 cache telemetry 归一化。
- SSE 响应 cache telemetry 归一化，且不重复累计。
- 相同大请求重复发送时，第二次 metadata 标记 `duplicateLargeRequestRepeated=true`。
- metadata 和 Redis value 不包含测试用 request body 正文。
- 全量 gateway 测试通过：`80 pass / 10 skip / 0 fail`。

后续仍未做：

- 不拦截重复请求。
- 不对小请求启用 duplicate guard。
- 不保存用户正文。
- 不改变桌面端 session 存储模式。
- 需要生产部署后观察 1-2 天，再决定是否进入 Phase C 拦截版。

## 2026-06-07 生产部署与观察

已将 Phase A/B 观测版部署到当前生产 `/root/opt/gugu` + systemd，未切 Docker，未改数据库 schema，未开启重复请求拦截。

部署前：

- 本地全量 gateway 测试通过：`80 pass / 10 skip / 0 fail`。
- 生产 local/public health 均 OK。
- 部署前即时 MySQL 备份成功：
  `/var/backups/gugu-gateway/gateway-mysql-20260607-220434.sql`，sha256 OK。
- 部署前 `gateway-alert-check` 返回 `ok=true`、`issues=[]`。

部署内容：

- 仅覆盖生产运行文件：
  - `/root/opt/gugu/src/index.ts`
  - `/root/opt/gugu/src/config.ts`
  - `/root/opt/gugu/src/types.ts`
- 生产旧文件备份在：
  `/root/opt/gugu-backups/cache-telemetry-observe-20260607220459/src/`

部署后：

- `systemctl restart gugu-gateway` 成功。
- `gugu-gateway` 为 `active`。
- local/public `/health` 均返回 `{"ok":true}`。
- `gateway-alert-check` 返回 `ok=true`、`issues=[]`。
- journal 只有预期的 stop/start 和新进程 listen，没有启动错误。
- admin metrics 已出现 `duplicateLargeRequests` 快照，当前 `enabled=true`、`backend=redis`、`fallbackActive=false`。

观察安排：

- 当前线程 heartbeat 已更新为“观察 gateway cache/referral”。
- 频率：每 6 小时一次，持续 8 次，约 48 小时。
- 只读检查 health、alert、`duplicateLargeRequests`、usage metadata cache/fingerprint 聚合，以及 referral 真实订单/奖励计数。
- 不打印 token、license、完整 device id、request body、messages、附件内容、完整 fingerprint、完整 referral code、invite URL 或 API key。

## 给 gateway agent 的一句话结论

不要把 session 放到 gateway。先把 cache hit/miss 和 request fingerprint 观测补齐，再用 Redis 短 TTL hash 对同一设备、同一模型、同一超大请求做重复保护。目标是减少取消后自动重试造成的重复上游调用，同时不保存任何用户正文。
