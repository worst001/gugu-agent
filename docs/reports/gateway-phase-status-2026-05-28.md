# Gateway 阶段状态总账 - 2026-05-28

## 结论

刚才说“推进完”不准确。准确说法是：0.1.17 桌面发布、MySQL 切换、支付真实订单验证、以及“模型接入只保留 Gugu 内置入口”这条支线已经推进到可验收状态；但 `gateway-load-and-resilience-plan.md` 里的所有 phase 并没有全部完成。

当前最关键的生产事实：

- 0.1.17 已经通过 GitHub Actions 发布，OSS/Gitee release 同步完成。
- 生产 gateway 已在 2026-05-28 13:16 CST 从 SQLite 切到 MySQL `gugu_gateway`。
- 微信和支付宝各完成一笔真实付款验证，订单均 fulfilled，均有激活码，通知均 processed。
- Redis 已在生产安装并限制本机访问；gateway limiter/circuit 已接入 Redis 并启用。
- Redis limiter/circuit 启用后的生产 monitor 在 2026-05-28 21:37:05 CST 通过，`ok=true`、`issues=[]`。
- 生产 recurring monitor timer 已启用，每 5 分钟运行一次 post-cutover monitor；最近一次运行在 2026-05-28 22:04:40 CST 通过，`issues=[]`，下一次计划运行时间是 2026-05-28 22:09:57 CST。
- Phase 4 attachment task 代码已在服务器本地时间 2026-05-29 00:01 CST 以 flags-off 方式部署到生产：local/public health 均为 `{"ok":true}`，真实 smoke device token 请求 `/v1/attachments/tasks` 返回 `404 ATTACHMENT_TASKS_DISABLED`，admin metrics 显示 `attachmentTasks.enabled=false`，部署后 24 小时 monitor `ok=true`、`issues=[]`。
- 现在仍处在 MySQL cutover 后的 24-72 小时观察期，SQLite 回滚快照和切换工件必须保留。

## 已完成

1. Gateway 单机保护加固

- 大请求本地拦截：超长 `Write(content)` 不再反复进入模型历史。
- Gateway `/v1/messages` 请求体限制已落地，超限在扣积分前拒绝。
- Gateway `/v1/attachments/parse` 已增加 JSON、文件、图片大小限制和 MIME 防护。
- Message 和 GLM 附件解析已有独立进程内并发池和短队列。
- 单机 token bucket 限流已落地，覆盖设备注册、订单创建、message、attachment。
- DeepSeek/GLM 超时、流式 idle timeout、熔断、失败退款路径已补强。
- 支付通知幂等和交易号唯一约束已落地。
- 维护模式和写冻结已落地，可在迁移/回滚窗口拦截新订单和公开写入。

2. 数据库迁移

- MySQL 8.4.9 已安装在生产同机，监听 `127.0.0.1:3306`。
- MySQL schema、导出、校验、contract test、cutover rehearsal 工具已完成。
- 生产 MySQL rehearsal 和 rollback rehearsal 已通过。
- 生产已正式切换到 `GUGU_STORE_DRIVER=mysql`。
- `post-cutover-monitor.ts` 已跑过 24 小时窗口检查，结果 `ok=true`、`issues=[]`。
- 生产 MySQL backup timer 部署后再次执行 monitor，仍然 `ok=true`、`issues=[]`。

3. 支付链路

- 微信证书路径问题已修复。
- 微信真实支付订单已验证通过。
- 支付宝真实支付订单已验证通过。
- 订单金额、状态、激活码、通知处理均已核对。

4. 桌面 0.1.17 发布

- 0.1.16 已存在旧 tag，因此改走 0.1.17。
- 0.1.17 release commit 和 tag 已推送。
- GitHub Actions 桌面发布工作流已成功。
- OSS `latest.json` / `release.json` 已指向 0.1.17。
- Gitee Release 已存在。

5. 本轮新插入的模型接入收敛

- 已把公开 provider preset 收敛为 `gugu-managed` 和 `custom`。
- 桌面设置页只允许添加自定义接口，不再公开展示第三方厂商预设。
- 自定义接口保留通用协议选项：Anthropic Messages 兼容、OpenAI Chat 兼容、OpenAI Responses 兼容。
- 旧 presetId 运行时 env 兼容已保留，避免已有内测用户升级后失效。
- 相关桌面和服务端测试已通过。
- 这部分已 commit 并推送到当前分支，但尚未 release。

6. Redis limiter/circuit 和生产监控 timer

- Redis 6.2.20 已安装，监听 `127.0.0.1:6379`。
- gateway 已补 Redis-backed rate limiter 和 circuit breaker 代码。
- 新增 `GUGU_REDIS_URL`、`GUGU_REDIS_LIMITER_ENABLED`、`GUGU_REDIS_CIRCUIT_ENABLED`、`GUGU_REDIS_COMMAND_TIMEOUT_MS`。
- Redis backend 支持 fallback：Redis 命令失败时回落到内存实现，避免 gateway 因 Redis 抖动直接拒绝请求。
- 本地 gateway 测试已通过。
- 生产已打开 `GUGU_REDIS_LIMITER_ENABLED=1` 和 `GUGU_REDIS_CIRCUIT_ENABLED=1`。
- 生产 smoke 已确认 Redis limiter key 产生；admin metrics 显示 DeepSeek/GLM circuit `backend=redis`、`fallbackActive=false`。
- `gugu-gateway-monitor.timer` 已部署到生产并启用，每 5 分钟运行一次只读支付/健康 monitor。
- 2026-05-28 21:59 CST 已部署 managed GLM file_parser 修复：gateway 会为 Office/PDF 文件补 `file_type`，并在 GLM 返回 `task_id` 时继续拉取 `/files/parser/result/{task_id}/text`，避免内测用户长文档解析只拿到空任务结果。
- 桌面端附件解析阶段增加 15 秒一次的状态心跳；长附件解析发生在 CLI turn monitor 启动前时，用户也能看到“正在解析附件，已等待 N 秒”。

## 部分完成

1. Phase 2 观测和运维

- 已完成结构化请求日志。
- 已完成 `/admin/api/metrics` 基础指标接口。
- 已完成生产 post-cutover read-only monitor 脚本。
- 已完成生产 `gugu-gateway-monitor.timer`，当前每 5 分钟检查健康、最近订单、最近支付通知和 24 小时窗口内的异常支付链路。
- 未完成外部告警闭环，例如每分钟健康检查、磁盘/内存/CPU 告警、5xx/429/上游错误率告警。
- 未确认是否已有长期 dashboard 或告警通知渠道。

2. Phase 3 数据和备份

- SQLite 备份和 restore-check 脚本已完成。
- systemd backup service/timer 模板已完成。
- 生产已确认没有安装旧的 `gugu-gateway-backup.timer`。
- 由于生产已切到 MySQL，旧 SQLite timer 不能覆盖 active 业务数据。
- 已补 MySQL backup 脚本和 `gugu-gateway-mysql-backup` systemd timer 模板。
- 生产当前布局 `/root/opt/gugu` 已部署 MySQL nightly backup timer。
- 手动 systemd backup 验收已通过，`gateway-mysql-20260528-163030.sql` 的 sha256 校验 OK。
- timer 已 enabled，下一次运行时间是 2026-05-29 03:38:38 CST。
- MySQL 切换后 72 小时观察期尚未结束，不能清理回滚工件。

3. systemd 和生产布局

- gateway 现在已经由 `gugu-gateway.service` 管理。
- 但生产仍运行在 `/root/opt/gugu`。
- runbook 目标布局 `/opt/gugu-gateway`、`/etc/gugu-gateway/gateway.env`、非 root `gugu` 用户尚未迁移。
- 这项不建议在刚切 MySQL 和刚发布桌面的压力期马上做。

## 未完成

1. Phase 4 附件解析任务队列

- 已完成第一阶段代码，并已 flags-off 部署到生产；任务队列尚未灰度启用。
- 这会改变客户端体验和协议：任务提交、排队、状态查询、结果回取、失败重试。
- gateway 新增默认关闭的 `POST /v1/attachments/tasks` 和 `GET /v1/attachments/tasks/:id`，并在 admin metrics 暴露任务队列快照。
- 桌面端 managed 附件解析会优先尝试异步 task；旧 gateway、关闭开关或 `ATTACHMENT_TASKS_DISABLED` 会自动回退原同步 `/v1/attachments/parse`。
- 任务状态包含 `provider` 字段，当前为 `glm`；后续 DeepSeek V4 多模态上线时，应通过 provider/worker 配置平滑切到 `deepseek-v4` 识图，不改客户端 task 协议。
- Redis 状态/lease 骨架已完成但默认关闭：`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1` 时，task metadata、状态计数和 worker lease 会写 Redis；Redis 异常或未配置 URL 时回落进程内状态。
- 本地 payload spool 已完成：任务请求体写入 `GUGU_ATTACHMENT_TASK_SPOOL_DIR`，worker 执行时读回，完成后删除；超过 `GUGU_ATTACHMENT_TASK_SPOOL_MAX_BYTES` 会在上游调用前 413；`GUGU_ATTACHMENT_TASK_SPOOL_CLEANUP_INTERVAL_MS` 控制启动/运行期清理守护，守护只清理超过安全窗口的 orphan `.json`，并跳过当前进程正在引用的 payload。
- async task 失败退款边界已用回归测试固定：任务执行复用 `forwardAttachment`，上游失败会沿用同步路径退款并透传剩余额度；自动重试暂不启用，等后续有幂等 reservation/usage event 设计后再做。
- 灰度验证顺序已写入计划：先代码默认关闭并验证桌面回退同步解析，再内测打开本机 memory task，最后打开 Redis metadata；回滚只需关闭 `GUGU_ATTACHMENT_TASKS_ENABLED` 并重启 gateway。
- 当前仍不是多实例正式队列：payload 仍在本机 spool，共享文件系统或私有对象存储未规范化。
- 内测和单机阶段不把用户上传附件 payload 写入 OSS，避免对象数量、流量、隐私和生命周期管理失控；OSS 只作为未来多实例的可选方案，且必须私有、限额、短 TTL。
- Phase 4 代码面已基本完成并 flags-off 生产部署，尚未灰度启用；自动重试作为后续幂等扣费设计的一部分再推进。
- 已先补低风险前置项：managed file_parser 会追 `task_id` 结果，桌面附件解析会持续显示等待状态。

2. Phase 5 Docker、多实例和全局扩容

- 本地 Docker MySQL dry-run 做过。
- 生产 gateway 还没有 Docker 化。
- 还没有多实例部署。
- 还没有 SLB/Nginx 多后端、Redis 全局限流、跨实例任务队列。

3. 文档和官网口径彻底清理

- 桌面模型接入入口已收敛。
- 历史文档里关于第三方厂商预设、DeepSeek/GLM/Kimi/Qwen 推荐式描述还没系统清理。
- 官网内容按之前边界没有修改。

## 建议继续顺序

1. 继续 24-72 小时 cutover 观察，不清理 SQLite 和切换工件。
2. 观察 `gugu-gateway-monitor.timer` 和 Redis limiter/circuit 生产日志，确认没有支付问题和 Redis fallback warning。
3. 附件解析 async task queue：默认关闭协议、Redis metadata/lease、本地 payload spool、spool 清理守护、失败退款回归测试和灰度验证顺序已完成；代码已 flags-off 部署到生产但尚未灰度启用；协议保持 provider-neutral，为 DeepSeek V4 多模态替换 GLM 留口。
4. Docker/多实例/生产目录规范化放最后，单独开维护窗口。

## 下一次对话 prompt

继续从 `docs/reports/gateway-phase-status-2026-05-28.md` 和 `docs/plans/0.1.16-current-handoff.md` 接手。注意：0.1.17 桌面发布已完成；生产 gateway 已在 2026-05-28 13:16 CST 切到 MySQL `gugu_gateway`；微信和支付宝真实支付均验证通过；Redis limiter/circuit 已在生产启用，admin metrics 显示 `backend=redis`、`fallbackActive=false`。2026-05-28 21:59 CST 已部署 gateway managed GLM file_parser `task_id` 追结果修复，重启后 health OK、monitor `issues=[]`。当前“模型接入只保留 Gugu 内置，其他走用户自定义接口”的改动已提交但尚未 release；桌面端附件解析 15 秒状态心跳已实现但也尚未 release。Phase 4 默认关闭协议、Redis metadata/lease、本地 payload spool、spool 清理守护、失败退款回归测试和灰度验证顺序已完成，并在服务器本地时间 2026-05-29 00:01 CST 以 flags-off 方式部署到生产：local/public health OK，真实 smoke token 请求 `/v1/attachments/tasks` 返回 `404 ATTACHMENT_TASKS_DISABLED`，admin metrics 显示 `attachmentTasks.enabled=false`，部署后 24 小时 monitor `ok=true`、`issues=[]`。生产尚未灰度启用 async task；`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1` 后才会把 task metadata/status/lease 写 Redis；任务请求体会写入 `GUGU_ATTACHMENT_TASK_SPOOL_DIR` 并在完成后删除，启动/运行期清理守护会按 `GUGU_ATTACHMENT_TASK_SPOOL_CLEANUP_INTERVAL_MS` 清理 stale orphan `.json`；上游失败沿用同步路径退款，自动重试暂不启用，等幂等 reservation/usage event 设计后再做。内测/单机阶段不要把用户上传附件 payload 写入 OSS；OSS 只作为未来多实例的可选方案，且必须私有、限额、短 TTL；协议通过 `task.provider` 保持 provider-neutral，当前 `glm`，后续 DeepSeek V4 多模态要平滑替换 worker/provider。生产 MySQL backup timer 已部署并 enabled，下一次运行时间是 2026-05-29 03:38:38 CST。下一步优先：观察 monitor/Redis fallback 日志；Docker/多实例/生产目录规范化最后做。
