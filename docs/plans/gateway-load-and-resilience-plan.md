# Gateway 负载与韧性优化计划

## 目标

当前 gateway 同时承担设备注册、订单、支付回调、Gugu Managed 模型转发、GLM 附件解析、官网页面和下载页。短期目标不是立即上复杂集群，而是先让单机版本在异常流量、超大请求、上游抖动和重复请求下稳定退让。

本计划优先保证三件事：

1. 服务不会被异常请求或大请求打爆。
2. 上游模型慢、失败或抖动时，gateway 能快速给出可解释错误，并保护用户额度。
3. 运维能看见当前负载、错误率、慢请求和容量水位。

## 当前形态

- 部署形态：Bun gateway 进程监听本机端口，Nginx 对外提供 HTTPS，并保留 8787 兼容代理。
- 存储：SQLite，本地文件数据库，已启用 WAL。
- 主要入口：
  - `POST /v1/messages`：Gugu Managed 模型转发。
  - `POST /v1/attachments/parse`：GLM 附件解析。
  - `POST /v1/devices`、`POST /v1/activate`：设备和授权。
  - `POST /v1/orders`、支付 notify：订单和支付。
  - 官网、下载页、管理接口。
- 高风险入口：`/v1/messages`、`/v1/attachments/parse`、支付回调、下载页突发流量。

保守容量估算：

- 注册或在线设备：几千台问题不大，设备数不等于并发。
- 同时活跃 AI 请求：先按 50-100 个设计。
- 同时 GLM 附件解析：先按 5-10 个设计。
- 试运营 DAU：100-300 较稳；300-800 取决于附件解析比例；1000+ 前需要补齐限流、监控和队列。

## 已完成

这些已经在当前工作区落地或正在随本轮修复进入发布：

- 本地代理对 Gugu Managed 请求体增加上限，超限直接返回 `413 PAYLOAD_TOO_LARGE`，不再转发到 gateway。
- Gateway 对 `/v1/messages` 增加 `GUGU_MESSAGE_MAX_REQUEST_BYTES`，默认 8 MiB，且在扣积分前检查。
- `Write` 工具的大 content 不再反复进入 API 历史，避免“写完大文件后下一轮请求还带着完整文件内容”。
- Gateway 对 `/v1/attachments/parse` 增加前置防护：`GUGU_GLM_JSON_MAX_REQUEST_BYTES`、`GUGU_FILE_PARSE_MAX_BYTES`、`GUGU_GLM_IMAGE_MAX_BYTES`，并在扣积分前拒绝超大附件和不支持 MIME。
- Gateway 对 `/v1/messages` 和 `/v1/attachments/parse` 增加独立并发池和短队列，超限返回 `429 GATEWAY_BUSY`，避免 AI/GLM 慢请求拖住支付、订单和健康检查。
- Gateway 增加单机 token bucket 限流：设备注册和订单创建按 IP 限制，message/attachment 按设备和套餐限制，超限返回 `429 RATE_LIMITED`，不扣积分。
- SQLite 已经开启 WAL。
- 关键业务表已有基础索引：设备、订单、usage events。
- 支付迁移前保护已落地：微信/支付宝交易号唯一约束、payment notify 幂等记录、维护模式拦新订单。
- 购买页和结算页已支持维护文案展示，后端 `/v1/orders` 在维护模式下返回 `503 MAINTENANCE`。

## 已确认业务边界

- 优先保 Gugu Managed 对话稳定，其次是支付订单绝对正确。
- 项目仍在内测阶段，可以接受凌晨 5-10 分钟维护窗口。
- 微信、支付宝已经接入真实收款，因此支付迁移要按生产级谨慎处理。
- 当前公开套餐是 `free`、`light`、`pro`、`max`，没有 `team`。
- MySQL 和 Redis 短期装在同一台服务器上，Docker 化放在最后。
- 服务器是 AliyunOS，按 CentOS/RHEL 系部署思路处理。
- MySQL 优先选择 MySQL 8.4 LTS。
- 当前服务器内存约 3.5 GB，同机部署必须走保守资源配置。
- Gateway 进程建议改为 systemd 管理。
- systemd 服务运行用户使用 `gugu`。
- 当前 SQLite 路径是 `/var/lib/gugu-gateway/gateway.sqlite`。
- 维护模式需要前端显示“维护中”，后端 API 也拒绝新订单。
- 新增配置放独立 env 文件，不和已有环境变量管理混在一起。
- SQLite 迁移后保留 7 天备份，其中前 72 小时作为快速回滚窗口。
- free 用户可以更严格限速；付费用户按 `light < pro < max` 提高队列优先级。
- MySQL 数据库名使用 `gugu_gateway`，应用用户使用 `gugu_gateway_app`。

## Phase 1：单机保护加固

Phase 1 是优先级最高的一组改动，目标是在不引入 Redis、PostgreSQL、任务队列的前提下，把单机试运营稳定性补齐。

### 1. 请求体和附件大小限制

需要做到两层限制：

- Nginx 层使用 `client_max_body_size` 和路由级限制。
- Gateway 应用层在解析前或解析后尽早校验，返回明确的 413/400。

建议默认值：

- `GUGU_MESSAGE_MAX_REQUEST_BYTES=8388608`，普通对话 JSON 最大 8 MiB。
- `GUGU_GLM_JSON_MAX_REQUEST_BYTES=20971520`，GLM JSON 请求最大 20 MiB。
- `GUGU_FILE_PARSE_MAX_BYTES=20971520`，GLM 文件解析解码后最大 20 MiB。
- `GUGU_GLM_IMAGE_MAX_BYTES=8388608`，图片类单独收紧到 8 MiB。
- 压缩包不走远程 GLM 解析，客户端优先本地解压，无法本地处理时提示用户手动解压。

实现要点：

- `/v1/messages` 已有扣积分前限制，下一步要避免超大 body 在 `readJson(req)` 阶段占用过多内存。
- `/v1/attachments/parse` 需要在 `dataBase64` 解码前估算大小，并按 MIME 白名单拒绝不支持格式。
- 错误码统一为 `PAYLOAD_TOO_LARGE`、`UNSUPPORTED_FILE_TYPE`、`BAD_REQUEST`。

验收：

- 超大 message 请求返回 413，不扣点，不调用上游。
- 超大附件返回 413，不扣点，不解码成 Buffer。
- 不支持格式返回 400，不扣点。

### 2. 并发限制和小队列

当前长连接请求主要风险是同时占用 gateway、Nginx 和上游连接。Phase 1 先做进程内并发池，单机足够用。

建议默认值：

- `GUGU_MESSAGE_MAX_CONCURRENCY=80`
- `GUGU_MESSAGE_QUEUE_LIMIT=40`
- `GUGU_MESSAGE_QUEUE_TIMEOUT_MS=3000`
- `GUGU_GLM_MAX_CONCURRENCY=8`
- `GUGU_GLM_QUEUE_LIMIT=16`
- `GUGU_GLM_QUEUE_TIMEOUT_MS=3000`

行为：

- 有空位时立即执行。
- 短队列内等待少量请求，超过等待时间返回 429。
- 队列满直接返回 429 `GATEWAY_BUSY`。
- 支付回调、设备注册、订单查询不进入 AI/GLM 并发池，避免被模型请求拖住。

验收：

- 并发超过上限时，超出的请求可控地返回 429。
- 队列等待不会无限占用连接。
- AI 和 GLM 使用独立池，GLM 慢不会拖垮对话转发。

### 3. 单设备和单 IP 速率限制

Phase 1 先使用进程内 token bucket。多实例前它不是全局严格限流，但足够防误操作和小规模滥用。

建议策略：

- 设备维度：按 `deviceToken` 限制 message 和 attachment。
- IP 维度：按 `x-forwarded-for` 或 `req.headers` 来源限制未授权入口和注册入口。
- 套餐维度：free plan 更低，付费套餐按 `light < pro < max` 递增。

建议默认值：

- free message：6/min。
- light message：20/min。
- pro message：40/min。
- max message：60/min。
- free attachment parse：2/min。
- light attachment parse：4/min。
- pro attachment parse：8/min。
- max attachment parse：12/min。
- device register：20/min/IP。
- order create：10/min/IP。

验收：

- 同一设备快速重试会返回 429，不消耗额度。
- 注册和订单创建不会被单 IP 刷爆。

### 4. 超时、流式 idle timeout 和熔断

现在 DeepSeek/GLM 请求有总超时，但还需要区分连接、首包、流式 idle、连续失败。

建议配置：

- `GUGU_DEEPSEEK_TIMEOUT_MS=90000`
- `GUGU_DEEPSEEK_STREAM_IDLE_TIMEOUT_MS=120000`
- `GUGU_DEEPSEEK_CIRCUIT_FAILURE_THRESHOLD=5`
- `GUGU_DEEPSEEK_CIRCUIT_OPEN_MS=30000`
- `GUGU_GLM_REQUEST_TIMEOUT_MS=120000`
- `GUGU_GLM_CIRCUIT_FAILURE_THRESHOLD=5`
- `GUGU_GLM_CIRCUIT_OPEN_MS=30000`

行为：

- 上游超时返回 504，并退款。
- 上游网络错误返回 502，并退款。
- 连续失败后短暂熔断，返回 503 `UPSTREAM_CIRCUIT_OPEN`，不扣点。
- 流式响应如果长时间无数据，主动中断并记录 `streamIdleTimeout`。

验收：

- 上游超时、网络错误、熔断都不扣点。
- 错误响应包含明确错误码。
- 结构化日志能看到 upstream、model、duration、errorCode。

### 5. 积分和幂等保护

已有逻辑是先扣点，再调用上游，失败退款。下一步补强：

- 所有“扣点后调用上游”的路径都必须在异常时退款。
- `recordUsageTokens` 不应让已经成功的上游响应变成 500。
- 订单创建和支付回调继续保持幂等。
- 支付回调只做签名校验和本地状态变更，避免长耗时外部依赖。

建议补充：

- 包装 `safeRecordUsageTokens`，记录失败日志但不影响已成功响应。
- 支付交易号增加唯一索引或显式幂等判断。
- message/attachment 可接受可选 `Idempotency-Key`，Phase 1 先记录，Phase 2 再用于任务队列。

验收：

- usage 记录失败不会吞掉模型成功结果。
- 重复支付回调不会重复发码或重复加额度。

## Phase 2：观测和运维

Phase 2 可以和 Phase 1 并行推进一部分，但不应该阻塞限流和并发池。

### 结构化日志

每个请求输出一条 JSON 日志，至少包含：

- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `deviceHash`
- `plan`
- `operation`
- `model`
- `upstream`
- `upstreamStatus`
- `errorCode`
- `requestBytes`
- `responseBytes`
- `creditsCharged`
- `creditsRefunded`

注意：不要输出 device token、license key、支付密钥、完整文件名路径、完整 prompt。

### Metrics 和 Dashboard

增加轻量指标接口，优先放在 admin 接口后面：

- 当前 message 并发、队列长度。
- 当前 GLM 并发、队列长度。
- 今日 message 数、attachment 数、扣点数。
- 上游错误率。
- p50/p95/p99 耗时。
- SQLite busy/locked 次数。
- 413/429/5xx 计数。

Dashboard 先展示关键水位，不追求复杂图表。

### 外部监控

最低限度：

- Nginx access/error log。
- 每分钟 `/health` 检查。
- 每分钟磁盘、内存、CPU 检查。
- 备份失败告警。
- 5xx、429、上游错误率异常告警。

## Phase 3：数据和备份

短期继续 SQLite，但要补齐：

- `PRAGMA busy_timeout`。
- 定期 WAL checkpoint。
- 每日备份 SQLite 主库、WAL、SHM 到 OSS。
- 备份保留 7-30 天。
- 管理端报表避免重查询拖慢主请求。

建议新增脚本：

- `gateway/scripts/backup.ts`
- `gateway/scripts/healthcheck.ts`
- `gateway/scripts/restore-check.ts`

验收：

- 备份文件可恢复到临时库。
- 备份失败会告警。
- dashboard 查询不会明显影响 message 转发。

## Phase 4：附件解析任务队列

当附件解析开始明显影响在线请求时，再把附件解析拆成异步任务。当前上游仍是 GLM；后续 DeepSeek V4 多模态上线后，这一层必须平滑切到 DeepSeek V4 识图，所以协议命名要保持 provider-neutral，不能把客户端协议绑死到 GLM。

形态：

- 主请求创建任务并扣点或冻结额度。
- worker 执行当前 provider 的解析逻辑。
- 客户端轮询任务状态。
- 失败时退款。
- 文件走 OSS 临时对象，设置生命周期自动删除。

这一步会改客户端协议，放在 Phase 1 稳定后再做。

当前前置进展：

- managed GLM file_parser 已补 `file_type` 并支持 `task_id` 追结果，避免 GLM 先返回任务号时客户端拿不到正文。
- 桌面附件解析阶段已补 15 秒一次的状态心跳；附件解析发生在 CLI turn monitor 启动前时，用户也会看到“正在解析附件，已等待 N 秒”。
- 已补第一阶段异步协议代码，默认关闭：`POST /v1/attachments/tasks` 创建任务，`GET /v1/attachments/tasks/:id` 查询状态；响应里有 `task.provider`，当前值为 `glm`，后续可切到 `deepseek-v4` 而不改客户端协议。
- 桌面端 managed 附件解析会先尝试异步 task；如果 gateway 旧版本、未开启或返回 `ATTACHMENT_TASKS_DISABLED`，自动回退到原 `/v1/attachments/parse` 同步路径。
- 第一阶段实现仍是进程内任务表和 worker，不能直接当作多实例正式队列；Redis lease、文件落盘/OSS 临时对象、失败重试、失败退款和生产灰度开关仍是后续工作。

## 数据库与缓存平滑迁移

当前计划的目标数据库是 MySQL，Redis 只承载易失状态和跨实例协调，不承载强一致主业务数据。

### 同机部署约束

短期 MySQL、Redis、gateway、Nginx 在同一台服务器上运行，因此要先做资源边界：

- MySQL 选择 MySQL 8.4 LTS，安装方式以官方 MySQL Yum repository 为准，避免使用系统源里版本不一致的兼容包。
- 服务器内存约 3.5 GB，Redis 设置 `maxmemory` 和淘汰策略，避免 Redis 抢占 gateway 和 MySQL 内存。
- MySQL 设置保守的 buffer pool，先以稳定为主，不追求极限吞吐。初始建议 `innodb_buffer_pool_size` 控制在 512 MiB 左右，再按真实指标调整。
- Redis 初始建议 `maxmemory` 控制在 256 MiB 左右，限流/熔断/队列状态都必须设置 TTL。
- Gateway 使用 systemd 管理，配置独立服务名，例如 `gugu-gateway.service`。
- systemd 服务以 `gugu` 用户运行，数据目录使用 `/var/lib/gugu-gateway`。
- 当前 SQLite 主库路径是 `/var/lib/gugu-gateway/gateway.sqlite`。
- Gateway 的环境变量放独立文件，例如 `/etc/gugu-gateway/gateway.env`，systemd 通过 `EnvironmentFile=` 加载。
- MySQL/Redis 密码不要放进仓库，不复用原有 shell 环境变量名。
- MySQL、Redis 不直接暴露公网，只监听本机或内网安全地址。
- MySQL 数据库名使用 `gugu_gateway`，应用用户使用 `gugu_gateway_app`。

配套运行手册与模板：

- `docs/runbooks/gateway-systemd-mysql-redis.md`：同机 systemd、MySQL、Redis 安装、验证、维护模式和回滚 runbook。
- `gateway/deploy/systemd/gugu-gateway.service`：生产 systemd unit 模板。
- `gateway/deploy/env/gateway.env.example`：gateway 独立 env 模板。
- `gateway/deploy/env/mysql.env.example`：MySQL 安装/迁移脚本 env 模板。
- `gateway/deploy/env/redis.env.example`：Redis 安装/迁移脚本 env 模板。
- `gateway/deploy/mysql/gugu-gateway.cnf`：3.5 GB 同机部署的 MySQL 保守配置片段。
- `gateway/deploy/redis/gugu-gateway-redis.conf`：Redis 本机监听、内存上限和 noeviction 配置片段。

### systemd 与 env 文件约定

建议把配置分层：

- `/etc/gugu-gateway/gateway.env`：gateway 业务配置。
- `/etc/gugu-gateway/mysql.env`：仅安装/迁移脚本需要的 MySQL 初始化信息。
- `/etc/gugu-gateway/redis.env`：仅 Redis 管理脚本需要的连接信息。

Gateway 进程只读取 `gateway.env`。这样不会和当前用户 shell、发布脚本或旧环境变量互相污染。

维护模式相关变量也放在 `gateway.env`：

- `GUGU_MAINTENANCE_MODE=1`：进入维护模式。
- `GUGU_MAINTENANCE_DISABLE_ORDERS=1`：拒绝新订单和新支付二维码。
- `GUGU_MAINTENANCE_MESSAGE=系统维护中，购买和支付暂不可用，已支付订单会自动补发。`：前端展示的维护文案。

### 迁移边界

MySQL 落地这些强一致数据：

- devices
- activation_codes
- usage_events
- orders
- payment notify 幂等记录
- 后续 GLM tasks

Redis 落地这些短生命周期状态：

- 全局并发计数和队列状态
- 单设备、单 IP、套餐维度限流 token bucket
- 上游熔断状态
- 幂等请求的短期去重缓存
- 后续 worker 队列的 lease/lock 状态

不建议把订单、扣点流水、授权码这类强一致数据只放 Redis。

### 平滑过渡步骤

1. 抽象存储接口
   - 先把 `GatewayStore` 拆成接口和 SQLite 实现。
   - 业务代码只依赖接口，不直接依赖 `bun:sqlite`。
   - 测试用同一套 contract tests 跑 SQLite 和 MySQL 实现。

2. MySQL 建表和回填
   - 新增 `gateway/src/mysqlStore.ts` 或独立数据层。
   - 建表字段与现有 SQLite 语义保持一致。
   - 先从 SQLite 导出全量数据，导入 MySQL。
   - 导入后对行数、订单金额、credits 汇总、usage 汇总做校验。

3. 影子写入
   - 生产仍以 SQLite 为主。
   - 关键写入同时写 MySQL。
   - MySQL 写失败只报警，不影响主链路。
   - 每日跑一致性校验，观察至少 3-7 天。

4. 只读切换
   - dashboard、报表类读请求先切到 MySQL。
   - 主交易路径仍从 SQLite 读写。
   - 观察查询性能、索引、慢查询。

5. 主写切换
   - 短维护窗口内停止 gateway 写入。
   - 做最后一次 SQLite -> MySQL 增量同步和校验。
   - 设置 `GUGU_STORE_DRIVER=mysql`，主业务读写切到 MySQL。
   - SQLite 保持只读备份，不立即删除。

6. 回滚窗口
   - 切换后保留 24-72 小时回滚窗口。
   - 如需回滚，停止 gateway，将 MySQL 切换期间新增写入反向导出到 SQLite，再切回 `sqlite` driver。
   - 回滚期间暂停订单创建和付费激活，避免双向补偿复杂化。

### Redis 过渡步骤

Redis 不需要一次性替换进程内状态，按风险递增迁移：

1. 先把限流状态迁到 Redis，保留进程内 fallback。
2. 再把熔断状态迁到 Redis，让多实例共享上游健康状态。
3. GLM 队列异步化时，再把队列状态和 worker lease 放 Redis。
4. 多实例部署前，进程内并发池仍保留为本实例保护，Redis 负责全局保护。

关键原则：

- Redis 故障时宁可降级为更保守的本地限流，也不要放开无限流量。
- Redis 中的 idempotency key 必须有 TTL。
- Redis 只做协调，最终账务以 MySQL 为准。

当前状态：

- Redis-backed 限流和熔断代码已完成。
- `GUGU_REDIS_LIMITER_ENABLED=1` 后，设备/IP token bucket 会优先使用 Redis，Redis 命令失败时回落进程内 token bucket。
- `GUGU_REDIS_CIRCUIT_ENABLED=1` 后，DeepSeek/GLM circuit 状态会优先使用 Redis，Redis 命令失败时回落进程内 circuit。
- 生产已打开 Redis limiter/circuit；admin metrics 已确认 DeepSeek/GLM circuit `backend=redis`、`fallbackActive=false`。
- GLM 队列状态和 worker lease 尚未迁入 Redis。

### 支付链路迁移保护

现有代码已经做了这些保护：

- 微信、支付宝回调都会验签。
- 回调金额必须和订单金额一致。
- 重复同一笔成功回调不会重复发码。
- 订单已 fulfilled 后再次 fulfill 会返回原 license key。

迁移前还需要补强：

- 给 `wechat_transaction_id` 和 `alipay_trade_no` 增加唯一索引，排除同一支付交易号落到多个订单的风险。已完成。
- 增加 payment notify 幂等记录表，保存 provider、notify id 或 transaction id、order id、处理状态、首次/最近处理时间。已完成。
- 增加维护模式开关：维护窗口内禁止新订单创建和新支付二维码生成。已完成。
- 维护窗口内收到支付回调时，如果数据库正在迁移，返回失败，让支付平台稍后重试；不要在迁移中双写两边。
- 迁移完成后提供订单补偿脚本，可以按交易号或订单号查询支付平台并补 fulfill。

支付平台回调重试策略需要以商户平台当前官方文档为准。工程上不能依赖“平台一定最终重试成功”，所以必须同时保留主动查询和后台补偿能力。

### 切换开关

建议提前设计这些环境变量：

- `GUGU_STORE_DRIVER=sqlite|mysql`
- `GUGU_MYSQL_URL`
- `GUGU_REDIS_URL`
- `GUGU_ENV_FILE=/etc/gugu-gateway/gateway.env`
- `GUGU_DUAL_WRITE_MYSQL=0|1`
- `GUGU_READ_REPORTS_FROM_MYSQL=0|1`
- `GUGU_REDIS_LIMITER_ENABLED=0|1`
- `GUGU_REDIS_CIRCUIT_ENABLED=0|1`
- `GUGU_MAINTENANCE_MODE=0|1`
- `GUGU_MAINTENANCE_DISABLE_ORDERS=0|1`
- `GUGU_MAINTENANCE_MESSAGE`

验收：

- SQLite 和 MySQL contract tests 行为一致。
- 影子写入期间核心表每日一致性校验通过。
- MySQL 慢查询可见，关键查询有索引。
- Redis 不可用时，gateway 返回保守 429 或使用本地 fallback，不出现无限放行。
- 支付迁移窗口内不会产生 SQLite/MySQL 混写。
- systemd 可启动、停止、重启 gateway，并能从独立 env 文件加载配置。
- 维护模式开启后，前端显示维护文案，后端拒绝新订单。
- 有明确回滚脚本和切换 runbook；当前基线见 `docs/runbooks/gateway-systemd-mysql-redis.md`。

## Phase 5：容器化、多实例和数据库升级

Docker 值得做，但不是第一优先级。它解决部署一致性和回滚，不直接解决限流、扣点、超时和观测。

触发条件：

- DAU 稳定超过 800-1000。
- 单机并发经常接近 Phase 1 上限。
- SQLite busy/locked 明显增长。
- 需要灰度发布和快速回滚。

路线：

1. Docker 化 gateway、nginx、备份任务、监控脚本。
2. Redis 承载全局限流、队列状态和熔断状态。
3. MySQL 替代 SQLite，按“数据库与缓存平滑迁移”章节逐步切换。
4. Nginx 或 SLB 挂多个 gateway 实例。
5. 灰度发布和回滚脚本标准化。

## 暂缓事项

这些现在不建议先做：

- 直接多实例部署：没有全局限流和共享状态前，容易把问题放大。
- 直接迁移 MySQL：当前最大风险是请求保护和上游韧性，不是数据库容量；迁移要走影子写入和校验。
- 复杂消息队列：GLM 异步化前先用进程内并发池和限流把风险控住。
- 过早 Docker 化：容器不会自动修复超时、扣点、日志和大请求问题。

## 推荐实施顺序

1. 合并并发布当前 413 和 Write 历史瘦身修复。
2. 给 `/v1/attachments/parse` 补大小、MIME 白名单和扣点前校验。已完成。
3. 增加 message/GLM 独立并发池和 429 `GATEWAY_BUSY`。已完成。
4. 增加单设备、单 IP、套餐维度限流。已完成。
5. 增加上游熔断和流式 idle timeout。
6. 增加结构化日志和 admin metrics。
7. 增加 SQLite busy_timeout、checkpoint、备份脚本。
8. 根据真实指标决定是否进入 GLM 任务队列。

## Phase 1 代码改动清单

- `gateway/src/config.ts`
  - 增加并发、队列、限流、GLM body/file 大小、熔断配置。
- `gateway/src/types.ts`
  - 补齐新增 config 字段。
- `gateway/src/index.ts`
  - 在 `/v1/messages`、`/v1/attachments/parse` 外层加 body guard、并发池、限流、熔断。
  - 统一 413、429、502、503、504 错误形状。
  - 增加 requestId 和结构化日志。
- `gateway/src/store.ts`
  - 增加 `busy_timeout`。
  - 补支付幂等索引或显式幂等检查。
  - 提供安全 usage 记录包装。
- `gateway/src/__tests__/gateway.test.ts`
  - 覆盖超大附件、并发超限、队列超时、限流、熔断、退款和 usage 记录失败。

## 验收标准

Phase 1 完成后，应满足：

- 超大 message 和附件请求不会调用上游，不扣点。
- 超并发返回 429，服务仍可响应健康检查和订单支付接口。
- 上游超时、网络错误、熔断均不扣点或会退款。
- usage 记录失败不会吞掉成功的上游响应。
- 日志能定位一次请求的路径、耗时、状态、上游错误和扣点结果。
- 相关 Bun 测试通过。
