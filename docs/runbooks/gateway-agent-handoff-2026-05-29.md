# Gateway Agent Handoff - 2026-05-29

这份文档给后续专门推进 gateway 的 agent 使用。它记录当前生产事实、代码状态、运行手册、禁区和下一步顺序。接手时优先读这份，再读：

- `docs/runbooks/gateway-systemd-mysql-redis.md`
- `docs/plans/gateway-load-and-resilience-plan.md`
- `docs/reports/gateway-phase-status-2026-05-28.md`
- `docs/plans/0.1.16-current-handoff.md`

## 当前结论

截至服务器本地时间 `2026-05-29 00:14:09 CST`：

- 生产 gateway 正常运行，`gugu-gateway`、`mysqld`、`redis` 都是 `active`。
- 本地健康检查 `http://127.0.0.1:18787/health` 和公网健康检查 `https://gugu.guxingyao.com/health` 都返回 `{"ok":true}`。
- 生产数据源已经切到 MySQL：`GUGU_STORE_DRIVER=mysql`。
- Redis limiter/circuit 已启用：`GUGU_REDIS_LIMITER_ENABLED=1`、`GUGU_REDIS_CIRCUIT_ENABLED=1`。
- Phase 4 attachment task 代码已经以 flags-off 方式部署到生产，但没有灰度启用。admin metrics 显示 `attachmentTasks.enabled=false`、`redisEnabled=false`、`queued=0`、`running=0`、`completed=0`。
- 生产 monitor timer 每 5 分钟运行一次；最近查看到的运行时间是 `2026-05-29 00:11:24 CST`，日志结尾 `issues=[]`。
- MySQL backup timer 已启用，下一次计划运行时间是 `2026-05-29 03:38:35 CST`。

## 生产运行图

- 服务器：`139.196.214.54`
- SSH：`ssh -i "$env:USERPROFILE\.ssh\gugu_gateway_rsa" root@139.196.214.54`
- 当前生产目录：`/root/opt/gugu`
- systemd 服务：`gugu-gateway.service`
- 启动命令：`/root/.bun/bin/bun run start`
- 工作目录：`/root/opt/gugu`
- env 文件：`/root/opt/gugu/.env`
- gateway 监听：`127.0.0.1:18787`
- 公网入口：nginx -> `https://gugu.guxingyao.com`
- MySQL：`127.0.0.1:3306`，数据库 `gugu_gateway`
- Redis：`127.0.0.1:6379`
- MySQL 凭据 env：`/etc/gugu-gateway/mysql.env`
- Redis 凭据 env：`/etc/gugu-gateway/redis.env`
- 备份目录：`/var/backups/gugu-gateway`

注意：生产当前还不是规范化目录布局。目标布局是 `/opt/gugu-gateway`、`/etc/gugu-gateway/gateway.env`、非 root `gugu` 用户，但这件事应放在单独维护窗口做。

## 代码与分支

本地仓库：

- root 分支：`fix/bug-from-master`
- gateway 子模块分支：`master`
- root 最新相关提交：
  - `a7ea73b docs: record phase4 flags-off production deploy`
  - `aedfb0c docs: record attachment task rollout order`
  - `d2130e5 docs: record async attachment task refund boundary`
  - `ee422ca docs: record attachment spool cleanup guard`
- gateway 最新相关提交：
  - `f50f070 test: cover disabled attachment task rollout`
  - `c6e9b93 test: cover async attachment task refunds`
  - `2d6cf89 feat: clean stale attachment task spool files`
  - `bf3ffc4 feat: spool attachment task payloads`
  - `e144651 feat: add redis attachment task state`
  - `e39fe37 feat: add async attachment task api`

推送位置：

- gateway：Gitee `master`
- root：Gitee/GitHub `fix/bug-from-master`

## 已落地能力

单机保护：

- `/v1/messages` 有请求体大小上限，超限在扣点前拒绝。
- `Write(content)` 大内容不会反复进入模型历史，避免大文件写入后下一轮请求被撑爆。
- `/v1/attachments/parse` 有 JSON、文件、图片大小限制和 MIME 白名单。
- message 与 GLM attachment 有独立进程内并发池和短队列。
- device register、order create、message、attachment parse 已有单机 token bucket 限流。

上游韧性：

- DeepSeek/GLM 有 timeout、stream idle timeout、circuit breaker。
- 上游失败、超时、空结果会退款或不扣点。
- structured request log 和 `/admin/api/metrics` 已可用。

支付与订单：

- 微信和支付宝真实收款都已验证通过。
- 支付通知有幂等记录和交易号唯一保护。
- 维护模式可拒绝新订单。
- `GUGU_MAINTENANCE_DISABLE_WRITES=1` 可在数据库迁移/回滚窗口冻结公开写入。

数据与缓存：

- 生产已从 SQLite 切到 MySQL `gugu_gateway`。
- SQLite rollback 快照和 cutover 工件仍要保留到 24-72 小时观察期结束。
- Redis limiter/circuit 已在生产启用，Redis 异常时会回退到进程内状态。
- MySQL backup timer 已部署并 enabled。

附件异步任务 Phase 4：

- 新增默认关闭的 `POST /v1/attachments/tasks` 和 `GET /v1/attachments/tasks/:id`。
- 桌面端 managed 附件解析会优先尝试 task polling；旧 gateway、关闭开关或 `ATTACHMENT_TASKS_DISABLED` 会自动回退同步 `/v1/attachments/parse`。
- Redis task metadata/status/lease 已实现但默认关闭：`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1` 后才使用。
- payload 只落本机私有 spool，不进 Redis，也不进 OSS。
- spool 目录由 `GUGU_ATTACHMENT_TASK_SPOOL_DIR` 控制，默认最大 payload 由 `GUGU_ATTACHMENT_TASK_SPOOL_MAX_BYTES` 控制。
- `GUGU_ATTACHMENT_TASK_SPOOL_CLEANUP_INTERVAL_MS` 控制启动/运行期 orphan `.json` 清理。
- async task 失败退款边界已有回归测试。自动重试暂不启用，等幂等 reservation/usage event 设计后再做。

## 严格边界

- 不要把用户上传附件 payload 默认放 OSS。当前单机阶段只用本机私有 spool。OSS 只作为未来多实例可选方案，并且必须私有 bucket/prefix、严格限额、短 TTL，不能复用公开下载桶。
- 不要在没有明确灰度决定前打开 `GUGU_ATTACHMENT_TASKS_ENABLED=1`。
- 不要在 MySQL cutover 观察期内清理 SQLite 快照、cutover artifact 或 `/var/backups/gugu-gateway` 里的迁移工件。
- 不要改支付链路时省略真实 monitor。微信、支付宝已经真实收款，支付正确性优先级高于其他优化。
- 不要把第三方厂商 preset 重新暴露给国内用户入口。当前策略是只保留 Gugu 内置，其他让用户自定义。
- DeepSeek V4 多模态后续会上线，attachment task 协议必须保持 provider-neutral。当前 provider 是 `glm`，后续应能平滑切到 `deepseek-v4`。

## 常用只读检查

```bash
ssh -i "$env:USERPROFILE\.ssh\gugu_gateway_rsa" root@139.196.214.54
```

```bash
systemctl is-active gugu-gateway
systemctl is-active mysqld
systemctl is-active redis
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
systemctl list-timers 'gugu-gateway*' --no-pager
```

admin metrics：

```bash
set -a
. /root/opt/gugu/.env
set +a
curl -fsS -H "Authorization: Bearer ${GUGU_ADMIN_TOKEN}" \
  http://127.0.0.1:18787/admin/api/metrics
```

只读支付/健康 monitor：

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/post-cutover-monitor.ts \
  --env-file /root/opt/gugu/.env \
  --hours 24 \
  --recent 12
```

日志检查：

```bash
journalctl -u gugu-gateway -n 100 --no-pager
journalctl -u gugu-gateway-monitor.service -n 100 --no-pager
journalctl -u gugu-gateway-mysql-backup.service -n 100 --no-pager
```

重点搜索：

```bash
journalctl -u gugu-gateway --since '1 hour ago' --no-pager |
  grep -Ei 'error|failed|fallback|attachment task|redis|payment|wechat|alipay' || true
```

## 当前生产开关

已确认：

```bash
GUGU_STORE_DRIVER=mysql
GUGU_REDIS_LIMITER_ENABLED=1
GUGU_REDIS_CIRCUIT_ENABLED=1
GUGU_MAINTENANCE_MODE=0
GUGU_MAINTENANCE_DISABLE_ORDERS=0
GUGU_MAINTENANCE_DISABLE_WRITES=0
```

未在 env 中显式打开，当前通过默认值保持关闭：

```bash
GUGU_ATTACHMENT_TASKS_ENABLED=0
GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=0
```

metrics 中的 task 快照：

```json
{
  "enabled": false,
  "redisEnabled": false,
  "backend": "memory",
  "fallbackActive": false,
  "queued": 0,
  "running": 0,
  "completed": 0,
  "queueLimit": 16,
  "workerConcurrency": 2,
  "retentionMs": 3600000,
  "spoolCleanupIntervalMs": 300000,
  "spoolStaleMs": 3600000,
  "spoolCleaned": 0
}
```

## 当前部署方式

生产 `/root/opt/gugu` 不是 git checkout。上一次 Phase 4 flags-off 部署采用归档方式：

1. 本地 `git -C gateway archive` 生成 gateway tar。
2. `scp` 上传到生产 `/tmp`。
3. 生产备份当前 `/root/opt/gugu`。
4. 解包到 staging。
5. 从备份目录复制 `.env`、`node_modules`、证书目录和运行数据目录。
6. 切换 `/root/opt/gugu`。
7. `systemctl restart gugu-gateway`。
8. 验证 local/public health、task disabled、admin metrics、post-cutover monitor。

最近一次生产代码备份：

- `/root/opt/gugu-backups/gugu-before-phase4-20260528235640`
- `/root/opt/gugu-prev-phase4-20260528235640`

后续如果继续采用归档部署，必须保留相同验证顺序。不要直接覆盖 `.env`、证书、`node_modules` 或运行数据。

## 回滚

仅关闭 async task 灰度：

```bash
cd /root/opt/gugu
cp -a .env .env.attachment-task-disable-$(date +%Y%m%d%H%M%S).bak
sed -i 's/^GUGU_ATTACHMENT_TASKS_ENABLED=.*/GUGU_ATTACHMENT_TASKS_ENABLED=0/' .env || echo 'GUGU_ATTACHMENT_TASKS_ENABLED=0' >> .env
systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

代码回滚到 Phase 4 部署前目录：

```bash
systemctl stop gugu-gateway
mv /root/opt/gugu /root/opt/gugu-bad-$(date +%Y%m%d%H%M%S)
cp -a /root/opt/gugu-prev-phase4-20260528235640 /root/opt/gugu
systemctl start gugu-gateway
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
```

如果涉及 MySQL 回滚，不要只改 `GUGU_STORE_DRIVER=sqlite`。MySQL 切换后已经有新写入，回滚需要先进入维护/write freeze，再做数据差异核对和补偿。参考 `docs/runbooks/gateway-systemd-mysql-redis.md`。

## 后续推荐顺序

1. 先观察到 `gugu-gateway-mysql-backup.timer` 在 `2026-05-29 03:38:35 CST` 首次自动执行成功，检查 manifest 和 sha256。
2. 继续观察 `gugu-gateway-monitor.timer`、Redis fallback warning、支付通知和 fulfilled 订单。
3. 如果要启用 attachment async task，按三段灰度：
   - 先保持代码已部署但 `GUGU_ATTACHMENT_TASKS_ENABLED=0`，确认桌面回退同步解析。
   - 小流量打开 `GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=0`，验证创建、轮询、成功、失败退款、spool 删除、stale cleanup。
   - 再打开 `GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`，验证 `backend=redis`、`fallbackActive=false`。
4. DeepSeek V4 多模态接入时，把 worker/provider 从 `glm` 平滑扩展到 `deepseek-v4`，不要改客户端 task 协议。
5. 再做生产目录规范化：`/opt/gugu-gateway`、`/etc/gugu-gateway/gateway.env`、非 root `gugu` 用户。
6. Docker、多实例、SLB/Nginx 多后端放最后，等单机指标和真实压力证明需要再推进。

## 给下一位 gateway agent 的 prompt

请从 `docs/runbooks/gateway-agent-handoff-2026-05-29.md` 接手 gateway。当前生产在 `139.196.214.54`，运行目录 `/root/opt/gugu`，服务 `gugu-gateway.service`，MySQL `gugu_gateway` 已是 active store，Redis limiter/circuit 已启用，微信和支付宝真实支付已验证。Phase 4 attachment task 代码已 flags-off 部署到生产，但尚未灰度启用，`/v1/attachments/tasks` 应保持 `404 ATTACHMENT_TASKS_DISABLED`，admin metrics 应显示 `attachmentTasks.enabled=false`。不要把用户附件 payload 放 OSS；单机阶段只用本机私有 spool。下一步优先确认 MySQL backup timer 首次自动运行结果、继续观察 monitor/Redis fallback 日志，然后再决定是否按三段式灰度启用 attachment async task。DeepSeek V4 多模态后续会上线，task 协议必须保持 provider-neutral。
