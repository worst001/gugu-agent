# Gateway 阶段状态总账 - 2026-05-28

## 结论

刚才说“推进完”不准确。准确说法是：0.1.17 桌面发布、MySQL 切换、支付真实订单验证、以及“模型接入只保留 Gugu 内置入口”这条支线已经推进到可验收状态；但 `gateway-load-and-resilience-plan.md` 里的所有 phase 并没有全部完成。

当前最关键的生产事实：

- 0.1.17 已经通过 GitHub Actions 发布，OSS/Gitee release 同步完成。
- 生产 gateway 已在 2026-05-28 13:16 CST 从 SQLite 切到 MySQL `gugu_gateway`。
- 微信和支付宝各完成一笔真实付款验证，订单均 fulfilled，均有激活码，通知均 processed。
- Redis 已在生产安装并限制本机访问，但 gateway 代码尚未接入 Redis。
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
- 这部分尚未 commit，也尚未发布。

## 部分完成

1. Phase 2 观测和运维

- 已完成结构化请求日志。
- 已完成 `/admin/api/metrics` 基础指标接口。
- 已完成生产 post-cutover read-only monitor 脚本。
- 未完成外部告警闭环，例如每分钟健康检查、磁盘/内存/CPU 告警、5xx/429/上游错误率告警。
- 未确认是否已有长期 dashboard 或告警通知渠道。

2. Phase 3 数据和备份

- SQLite 备份和 restore-check 脚本已完成。
- systemd backup service/timer 模板已完成。
- 生产是否已经启用 nightly backup timer，还需要再查一次。
- MySQL 切换后 72 小时观察期尚未结束，不能清理回滚工件。

3. systemd 和生产布局

- gateway 现在已经由 `gugu-gateway.service` 管理。
- 但生产仍运行在 `/root/opt/gugu`。
- runbook 目标布局 `/opt/gugu-gateway`、`/etc/gugu-gateway/gateway.env`、非 root `gugu` 用户尚未迁移。
- 这项不建议在刚切 MySQL 和刚发布桌面的压力期马上做。

## 未完成

1. Redis 接入

- Redis 6.2.20 已安装，监听 `127.0.0.1:6379`。
- gateway 当前没有依赖 Redis。
- Redis-backed 限流、熔断状态、任务锁、队列 lease 都还没实现。
- 多实例前必须先完成 Redis 状态后端，否则单机限流无法全局生效。

2. Phase 4 GLM 任务队列

- 尚未做。
- 这会改变客户端体验和协议：任务提交、排队、状态查询、结果回取、失败重试。
- 当前只是用进程内并发池保护 GLM，不是异步任务系统。

3. Phase 5 Docker、多实例和全局扩容

- 本地 Docker MySQL dry-run 做过。
- 生产 gateway 还没有 Docker 化。
- 还没有多实例部署。
- 还没有 SLB/Nginx 多后端、Redis 全局限流、跨实例任务队列。

4. 文档和官网口径彻底清理

- 桌面模型接入入口已收敛。
- 历史文档里关于第三方厂商预设、DeepSeek/GLM/Kimi/Qwen 推荐式描述还没系统清理。
- 官网内容按之前边界没有修改。

## 建议继续顺序

1. 先把当前“模型接入收敛”改动 commit，但不急着发版。
2. 立即再跑一次生产只读 monitor，确认 MySQL、支付、健康状态仍然干净。
3. 核对生产 backup timer 是否启用；如果未启用，先启用并做一次 restore-check 验收。
4. 继续 24-72 小时 cutover 观察，不清理 SQLite 和切换工件。
5. MySQL 观察稳定后，再做 Redis-backed limiter/circuit，先 feature flag 默认关闭，再灰度打开。
6. GLM async task queue 放在 Redis 状态后端之后。
7. Docker/多实例/生产目录规范化放最后，单独开维护窗口。

## 下一次对话 prompt

继续从 `docs/reports/gateway-phase-status-2026-05-28.md` 和 `docs/plans/0.1.16-current-handoff.md` 接手。注意：0.1.17 桌面发布已完成；生产 gateway 已在 2026-05-28 13:16 CST 切到 MySQL `gugu_gateway`；微信和支付宝真实支付均验证通过；Redis 已安装但 gateway 未接入。当前工作区还有“模型接入只保留 Gugu 内置，其他走用户自定义接口”的本地改动，测试已通过但尚未 commit/release。不要误判为所有 gateway phase 都完成。下一步优先：提交模型接入改动、跑生产只读 monitor、核对 backup timer，再推进 Redis-backed limiter/circuit。
