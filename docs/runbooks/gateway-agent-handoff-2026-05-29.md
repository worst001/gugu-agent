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
- Phase 4 attachment task 已进入 Redis metadata/lease 小流量灰度：`GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`。admin metrics 显示 `attachmentTasks.enabled=true`、`redisEnabled=true`、`backend=redis`、`fallbackActive=false`。
- 生产 monitor timer 每 5 分钟运行一次；最近查看到的运行时间是 `2026-05-29 00:11:24 CST`，日志结尾 `issues=[]`。
- MySQL backup timer 已启用，下一次计划运行时间是 `2026-05-29 03:38:35 CST`。

`2026-05-29 00:42 CST` 追加只读检查：

- `gugu-gateway`、`mysqld`、`redis` 仍为 `active`，本地 health 仍为 `{"ok":true}`。
- 机器负载很低：load average `0.02, 0.13, 0.09`；内存约 `3.5GB`，available 约 `1.1GB`；根分区使用率约 `40%`。
- `gugu-gateway-monitor.timer` 最近一次运行在 `2026-05-29 00:37:57 CST`，monitor 输出 `ok=true`、`issues=[]`。
- `gugu-gateway-mysql-backup.timer` 还未到首次自动运行时间；仍计划在 `2026-05-29 03:38:35 CST` 运行。
- 手动 MySQL backup service 最近一次成功记录是 `2026-05-28 16:30:30 CST`，产物 `/var/backups/gugu-gateway/gateway-mysql-20260528-163030.sql`，`bytes=400652`，`dumpMethod=js`，sha256 `39ba36018617e9e7ddd5a0ddbb1a22e8d0df5d1591a7589945ad0eb5cb3b1e1b`，表计数 `devices=13`、`activation_codes=13`、`usage_events=1813`、`orders=42`、`payment_notifications=2`。
- admin metrics 显示 message 队列 `active=0`、`waiting=0`，GLM 队列 `active=0`、`waiting=0`；DeepSeek/GLM circuit 均为 `closed`，`backend=redis`、`fallbackActive=false`。
- attachment task 仍按预期关闭：`enabled=false`、`redisEnabled=false`、`queued=0`、`running=0`、`completed=0`。
- 近一小时 gateway 日志没有 Redis fallback、支付失败、上游熔断或 timeout；有一段公网扫描 `.env`、`wp-config.php`、`docker-compose.yml` 等常见敏感路径的探测，均返回 `404 NOT_FOUND`。这不影响当前业务，但后续可放入 Nginx 边缘规则/告警降噪。
- 本地新增了 `gateway/scripts/mysql-restore-check.ts` 和 `bun run mysql-restore-check`，用于把 MySQL backup 恢复到 scratch/restore/dryrun/test 库后校验 sha256、表计数和基础支付/订单一致性；该脚本尚未部署到生产。

`2026-05-29 03:50 CST` 追加只读检查：

- `gugu-gateway`、`mysqld`、`redis` 仍为 `active`，本地 health 仍为 `{"ok":true}`。
- `gugu-gateway-mysql-backup.timer` 首次自动运行已执行：`LAST=Fri 2026-05-29 03:38:36 CST`，下一次计划 `Sat 2026-05-30 03:43:10 CST`。
- `gugu-gateway-mysql-backup.service` 运行成功，产物 `/var/backups/gugu-gateway/gateway-mysql-20260529-033837.sql`，大小约 `393K`，`bytes=401708`，`dumpMethod=js`。
- backup manifest 和 `.sha256` 文件已创建；`sha256sum -c /var/backups/gugu-gateway/gateway-mysql-20260529-033837.sql.sha256` 返回 `OK`，sha256 为 `7418f2cb101861c1c49f9d9e3e1f81c1c6587e3245f3936d966968e8b6af58bf`。
- manifest 表计数看起来正常：`devices=15`、`activation_codes=13`、`usage_events=1816`、`orders=42`、`payment_notifications=2`。
- `gugu-gateway-monitor.timer` 最近一次运行在 `2026-05-29 03:48:01 CST`，monitor 输出 `issues=[]`。
- admin metrics 显示 message/GLM 队列仍为空；DeepSeek/GLM circuit 均为 `closed`，`backend=redis`、`fallbackActive=false`；attachment task 仍关闭：`enabled=false`、`redisEnabled=false`、`queued=0`、`running=0`、`completed=0`。

`2026-05-31` 本地 Phase 2 告警闭环推进：

- 新增 `gateway/src/alerting.ts`、`gateway/scripts/gateway-alert-check.ts` 和 `bun run gateway-alert-check`。
- alert check 覆盖 local health、admin metrics、message/GLM 队列、DeepSeek/GLM circuit/Redis fallback、attachment task 开关是否符合预期、MySQL backup 新鲜度与 sha256、基础支付/订单一致性。
- 支持 `GUGU_ALERT_WEBHOOK_URL`，payload 支持 `generic`、`feishu`、`dingtalk`；未配置 webhook 时只输出 JSON，有 error 级 issue 时非零退出。
- 新增 `gateway/deploy/systemd/gugu-gateway-alert.service` 和 `gugu-gateway-alert.timer` 模板，尚未部署到生产。
- `deploy/env/gateway.env.example` 和 `docs/runbooks/gateway-systemd-mysql-redis.md` 已补 alert 配置与安装说明。
- 新增 `gateway/src/__tests__/alerting.test.ts` 覆盖告警判定和 webhook payload。

`2026-06-01 17:31-17:37 CST` Phase 2 alert 生产落地：

- 已把 `gateway/scripts/gateway-alert-check.ts` 和 `gateway/src/alerting.ts` 部署到生产 `/root/opt/gugu`。
- 新增 root-layout 模板 `gateway/deploy/systemd/gugu-gateway-alert.root.service` 和 `gateway/deploy/systemd/gugu-gateway-alert.root.timer`，用于当前生产 `/root/opt/gugu`、root 用户布局；生产 `/etc/systemd/system/gugu-gateway-alert.service` 和 `.timer` 已按这套布局安装。
- 手动启动 `gugu-gateway-alert.service` 成功，journal 输出 `ok=true`、`issues=[]`；local health `200 {"ok":true}`。
- alert check 验证最新 MySQL backup 新鲜且 `sha256Matches=true`，表计数为 `devices=17`、`activation_codes=14`、`usage_events=2273`、`orders=42`、`payment_notifications=2`。
- `gugu-gateway-alert.timer` 已 enabled/active；`enable --now` 触发的 `2026-06-01 17:32:11 CST` 运行成功，首轮自然调度 `2026-06-01 17:37:25 CST` 也成功，下一轮显示为 `2026-06-01 17:42:27 CST`。
- 当前未配置 `GUGU_ALERT_WEBHOOK_URL`，因此先以 journald JSON 输出和 systemd service 非零退出作为告警闭环；外部 IM/webhook 通知仍是后续待配置项。

`2026-06-01 18:43-19:08 CST` Phase 4 memory-only 灰度启用：

- 用户明确决定先跳过 `GUGU_ALERT_WEBHOOK_URL` 外部通知配置，继续推进后续 phase；当前 webhook 仍不配置。
- 生产 `.env` 已先备份为 `/root/opt/gugu/.env.phase4-memory-20260601184318.bak`。
- 已显式设置 `GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=0`，并同步 `GUGU_ALERT_EXPECT_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_ALERT_EXPECT_REDIS_ATTACHMENT_TASKS_ENABLED=0`。
- 已创建私有 spool 目录 `/var/lib/gugu-gateway/attachment-tasks`，权限 `0700 root:root`；`GUGU_ATTACHMENT_TASK_SPOOL_DIR` 指向该目录。
- `systemctl restart gugu-gateway` 后，`gugu-gateway`、`mysqld`、`redis` 仍为 `active`，local health 返回 `{"ok":true}`。
- 新增并部署 `gateway/scripts/phase4-attachment-task-smoke.ts`；production smoke 用 `text/plain` 的 `file_parser` 请求验证本地路径，不打 GLM 上游。
- smoke 结果：`POST /v1/attachments/tasks` 返回 `202`、`Retry-After=1`、`provider=glm`；轮询后 task 按预期 `failed`，`responseStatus=400`、`errorCode=UNSUPPORTED_FILE_TYPE`，spool 目录为空。
- smoke 后 admin metrics：`enabled=true`、`redisEnabled=false`、`backend=memory`、`fallbackActive=false`、`queued=0`、`running=0`、`completed=1`、`queueLimit=16`、`workerConcurrency=2`。
- `gugu-gateway-alert.service` 在 `2026-06-01 19:07:54 CST` 返回 `ok=true`、`issues=[]`；`post-cutover-monitor` 在 `2026-06-01 19:08:00 CST` 返回 `ok=true`、`issues=[]`。
- `systemctl list-timers 'gugu-gateway*'` 显示 monitor、alert、MySQL backup timers 均继续调度；最近 30 分钟 gateway 日志只看到重启时预期的 SIGTERM 和 smoke 请求日志，没有 Redis fallback、支付异常或上游错误。

`2026-06-02 22:42-22:46 CST` Phase 4 Redis metadata/lease 灰度启用：

- 24h memory-only 观察通过：`gugu-gateway`、`mysqld`、`redis` 和三组 timer 均为 `active`，local health `{"ok":true}`。
- `gateway-alert-check` 返回 `ok=true`、`issues=[]`；最新 MySQL backup 为 `/var/backups/gugu-gateway/gateway-mysql-20260602-034027.sql`，`sha256Matches=true`，表计数 `devices=20`、`activation_codes=14`、`usage_events=2387`、`orders=42`、`payment_notifications=2`。
- `post-cutover-monitor --hours 24 --recent 12` 返回 `ok=true`、`issues=[]`；spool 目录 `/var/lib/gugu-gateway/attachment-tasks` 没有残留 `.json`。
- Redis URL 已确认存在；生产 `.env` 已备份为 `/root/opt/gugu/.env.phase4-redis-20260602224317.bak`。
- 已设置 `GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_ALERT_EXPECT_REDIS_ATTACHMENT_TASKS_ENABLED=1`，并重启 `gugu-gateway`。
- 重启后 admin metrics：`enabled=true`、`redisEnabled=true`、`backend=redis`、`fallbackActive=false`、`queued=0`、`running=0`、`completed=0`。
- Redis task smoke 通过：`POST /v1/attachments/tasks` 返回 `202`、`Retry-After=1`、`provider=glm`；轮询后按预期 `failed`，`responseStatus=400`、`errorCode=UNSUPPORTED_FILE_TYPE`，spool 为空。
- smoke 后 admin metrics：`backend=redis`、`fallbackActive=false`、`completed=1`；Redis 中出现 `gugu:attachment-task:<id>` 和 `gugu:attachment-tasks:status:failed`。
- `gugu-gateway-alert.service` 在 `2026-06-02 22:45:47 CST` 返回 `ok=true`、`issues=[]`；`post-cutover-monitor` 在 `2026-06-02 22:45:56 CST` 返回 `ok=true`、`issues=[]`。
- 首轮自然 alert timer 在 `2026-06-02 22:51:09 CST` 自动运行成功，仍为 `ok=true`、`issues=[]`，下一轮显示为 `2026-06-02 22:56:12 CST`。

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

Phase 4 Redis metadata/lease 灰度当前显式打开：

```bash
GUGU_ATTACHMENT_TASKS_ENABLED=1
GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1
GUGU_ATTACHMENT_TASK_SPOOL_DIR=/var/lib/gugu-gateway/attachment-tasks
GUGU_ALERT_EXPECT_ATTACHMENT_TASKS_ENABLED=1
GUGU_ALERT_EXPECT_REDIS_ATTACHMENT_TASKS_ENABLED=1
```

metrics 中的 task 快照：

```json
{
  "enabled": true,
  "redisEnabled": true,
  "backend": "redis",
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

## 2026-06-04 Redis task 24h+ 观察

Phase 4 Redis metadata/status/lease 灰度已完成 24h+ 观察，可按单机生产阶段收口：

- 生产时间 `2026-06-04T14:31:34+08:00`，`gugu-gateway`、`mysqld`、`redis`、`gugu-gateway-monitor.timer`、`gugu-gateway-alert.timer`、`gugu-gateway-mysql-backup.timer` 均为 `active`。
- local health `http://127.0.0.1:18787/health` 返回 `{"ok":true}`。
- `gugu-gateway-alert.timer` 最近自然运行在 `2026-06-04 14:32:34 CST`，结果 `ok=true`、`issues=[]`、`webhook.sent=false`。外部 webhook 按用户决定继续跳过。
- `gugu-gateway-monitor.service` 最近运行在 `2026-06-04 14:30:02 CST`，结果 `ok=true`、`issues=[]`。
- 最新 MySQL 备份为 `/var/backups/gugu-gateway/gateway-mysql-20260604-034031.sql`，SQL、`.manifest.json`、`.sha256` 三件套存在；`sha256sum -c` 返回 `OK`。
- 最新备份 manifest：`bytes=579551`，`devices=29`、`activation_codes=20`、`usage_events=2756`、`orders=42`、`payment_notifications=2`，计数合理。
- admin metrics 中 `attachmentTasks.enabled=true`、`redisEnabled=true`、`backend=redis`、`fallbackActive=false`、`queued=0`、`running=0`、`completed=0`、`queueLimit=16`、`workerConcurrency=2`。
- `/var/lib/gugu-gateway/attachment-tasks` 下没有残留 `.json` spool 文件；Redis `gugu:attachment-task*` 扫描为空，说明上一轮 smoke key 已按 TTL/保留策略清理。
- 最近 48h gateway 日志未发现 `fallbackActive` 或 `ATTACHMENT_TASK_FAILED` 关键词。
- 当前负载仍很低：gateway 本轮启动后约 39.8h 累计 `2814` 个请求，约 `1.2 req/min`；主机 load average `0.35/0.14/0.09`，内存 available 约 `1.28 GiB`，根盘使用率 `41%`。

结论：Phase 4 在当前单机架构下已完成。后续不要急着上 OSS、多实例或 Docker；先保留 Redis task 开关和告警，继续看真实用户流量。

## 2026-06-04 Phase 5A 本地 Docker 沙盒

已在本地 `gateway/` 目录新增 Phase 5A 沙盒，不影响线上生产：

- `Dockerfile`：构建 Bun gateway runtime image，运行用户为 `bun`，runtime 数据写入 `/var/lib/gugu-gateway` 和 `/var/backups/gugu-gateway` volume。
- `compose.yaml`：本地启动 `gateway + mysql:8.4 + redis:7.4-alpine`，端口为 gateway `18787`、MySQL `3307`、Redis `6380`。
- `.dockerignore`：排除 `.env`、证书、SQLite、数据目录、`node_modules` 等敏感或本地运行产物。
- `deploy/docker/gateway.sandbox.env`：本地占位配置，使用 MySQL store、Redis limiter/circuit/task metadata，admin token 为 `local-admin-token`；DeepSeek/GLM 使用 dummy key 和 `127.0.0.1:9` dummy base URL，避免误打真实上游。
- `deploy/docker/README.md`：记录启动、health、metrics、schema check、task smoke、backup 和 reset 命令。

本地验收结果：

- `docker compose up -d --build` 成功，三个容器均 healthy。
- `GET http://127.0.0.1:18787/health` 返回 `{"ok":true}`。
- `bun run mysql-schema-check` 返回 `ok=true`，MySQL `8.4.9`，`missingTables=[]`、`missingIndexes=[]`。
- `bun run phase4-attachment-task-smoke --spool-dir /var/lib/gugu-gateway/attachment-tasks` 返回 `ok=true`，task `backend=redis`、`fallbackActive=false`、`queued=0`、`running=0`，spool 为空。
- `bun run mysql-backup --backup-dir /var/backups/gugu-gateway` 成功；容器内无 `mysqldump`，脚本按设计 fallback 到 JS logical dump。
- `bun run gateway-alert-check --backup-dir /var/backups/gugu-gateway` 返回 `ok=true`、`issues=[]`、`sha256Matches=true`。

生产仍保持 `/root/opt/gugu` + systemd，不要因为本地沙盒存在就直接切生产 Docker。下一步如继续 Phase 5，应先做 Compose 预演/生产切换预案，而不是直接多实例。

## 2026-06-04 Phase 5B Compose 预演件

已新增 Phase 5B 的本地自动验收和单机服务器 Compose 示例，仍未触碰线上生产：

- `gateway/scripts/docker-sandbox-check.ts`：host 侧验收脚本，串起 Compose config、容器运行状态、gateway health、admin metrics Redis 状态、MySQL schema、attachment task smoke、spool 空目录、MySQL backup 和 alert check。
- `package.json` 新增 `docker-sandbox-check` 脚本。
- `gateway/deploy/docker/compose.single-host.example.yaml`：未来单机服务器 Docker 化示例；只把 gateway 暴露到 `127.0.0.1:${GUGU_GATEWAY_HOST_PORT}`，MySQL/Redis 留在 Compose 网络内；带 `gateway-backup` 和 `gateway-alert` job profile，后续可映射到 systemd/cron 或 K8s CronJob。
- `gateway/deploy/docker/compose.single-host.env.example`：服务器 Compose 示例的占位变量模板，真实副本必须放私有路径，不要提交。
- `gateway/deploy/docker/README.md` 已补 Phase 5B 使用说明。

本地验收：

- `docker compose config --quiet` 通过。
- `docker compose --env-file deploy/docker/compose.single-host.env.example -f deploy/docker/compose.single-host.example.yaml config --quiet` 通过。
- `bun run docker-sandbox-check` 返回 `ok=true`，包含：三服务 running、health OK、Redis task/circuit `backend=redis` 且 `fallbackActive=false`、MySQL schema OK、attachment smoke OK、spool 空、backup 成功、alert `issues=[]`。

注意：单机服务器 Compose 文件只是预演模板，不是生产切换完成。生产切换前还需要私有 env、host volume、备份恢复校验、Nginx/public health、停机/回滚窗口和数据迁移计划。

## 2026-06-04 Phase 5C Docker 切换预案

已新增生产 Docker 切换预案，但没有执行生产切换：

- `gateway/deploy/docker/compose.gateway-only.example.yaml`：推荐的第一步生产 Docker 形态，只容器化 Bun gateway，宿主机 MySQL、Redis、Nginx、备份目录和证书/支付密钥不动；Linux 上使用 `network_mode: host`，继续复用 `127.0.0.1` MySQL/Redis 和 Nginx `127.0.0.1:18787` 回源。
- `docs/runbooks/gateway-docker-cutover-runbook.md`：Phase 5C draft runbook，覆盖 preflight、私有 env、镜像 build、可选 one-off dry-run、维护窗口切换、验证、回滚和明确禁止事项。
- `gateway/deploy/docker/README.md` 已补 gateway-only cutover 路线。

验证：

- `docker compose --env-file deploy/docker/compose.single-host.env.example -f deploy/docker/compose.gateway-only.example.yaml config --quiet` 通过。
- `git diff --check` 通过。

重要边界：不要把 MySQL/Redis 容器迁移和 gateway runtime 容器切换放在同一个生产窗口里。第一步如果真要切，也应只切 gateway-only；full-stack Docker 或 K8s 需要单独的数据迁移和回滚演练。

## 2026-06-04 Phase 5D 生产 readiness/预警/扩容/交接

已完成 Phase 5D 准备工作，没有执行生产切换：

- 生产 Docker 条件已只读确认：Alibaba Cloud Linux 3，Docker Engine `26.1.3`，Docker Compose `v2.27.0`，Docker service `active`，storage driver `overlay2`，Docker root `/var/lib/docker`，当前已有 9 个非 gateway 运行容器，不能盲目 prune。
- 主机资源：2 CPU、约 `3.5GiB` 内存，根盘 `/dev/nvme0n1p3` ext4，`40G` 总量、`22G` 可用、`41%` 使用；Docker root 约 `5.3G`，MySQL 数据约 `218M`，gateway backups 约 `10M`，日志约 `1.8G`。
- 端口拓扑：Nginx 监听 `80/443`，gateway `127.0.0.1:18787`，MySQL `127.0.0.1:3306`，Redis `127.0.0.1:6379`。
- 真实存储位置已沉淀：`/root/opt/gugu`、`/root/opt/gugu/.env`、`/etc/gugu-gateway`、`/var/lib/gugu-gateway`、`/var/lib/gugu-gateway/attachment-tasks`、`/var/lib/mysql`、`/var/lib/redis`、`/var/backups/gugu-gateway`、`/var/lib/docker`。这些观测到的路径都在同一块根盘上，尚无独立离线/异地备份目标。
- 新增 `docs/runbooks/gateway-warning-dashboard.md`：当前 journald/admin-metrics 预警面板规格，覆盖 health、service、timer、backup、Redis fallback、queue、5xx/429、host saturation、Docker storage。
- 新增 `docs/runbooks/gateway-phase5d-production-readiness.md`：生产只读检查结果、真实存储 map、离线备份策略、扩容路线、运维交接、Phase 5A-5D review。

Phase 5A-5D review 结论：本地 Docker 沙盒、Compose 自动验收、gateway-only 切换预案、生产 readiness/预警/扩容/交接都已准备好；生产尚未切 Docker。下一步不要贸然切换，优先补 off-host backup 策略或继续 DeepSeek V4 provider/worker 准备。

## 2026-06-04 Phase 5E off-host backup 准备

已完成 off-host backup 准备件，没有连接真实外部存储、没有上传生产备份：

- 新增 `gateway/scripts/mysql-offhost-stage.ts`：复用现有 MySQL backup 的 SQL、manifest、sha256 三件套，stage 到指定目标目录，写入 portable `.sha256` 和 `.offhost-manifest.json`，并校验 source/target sha、size 和 source/target 是否同 filesystem device。
- `package.json` 新增 `mysql-offhost-stage`。
- 新增 `gateway/deploy/env/offhost-backup.env.example`。
- 新增 systemd 模板：`gugu-gateway-mysql-offhost-backup.service/timer` 和 root layout 版本 `gugu-gateway-mysql-offhost-backup.root.service/timer`。模板未部署。
- 新增 `docs/runbooks/gateway-offhost-backup-runbook.md`，覆盖配置、手动 stage/verify、restore rehearsal、告警面板补充、运维策略和 systemd timer 安装边界。
- `docs/runbooks/gateway-warning-dashboard.md` 已补 off-host backup panel 和 critical alert。

本地沙盒验证：

- `bun run mysql-offhost-stage --help` OK。
- 容器内 `mysql-backup` 生成测试 SQL 备份后，`mysql-offhost-stage --out-dir /tmp/gugu-gateway-offhost-stage --target-label local-sandbox-stage` 返回 `ok=true`。
- `mysql-offhost-stage --verify-only --require-different-device` 返回 `ok=true`、`targetSha256Matches=true`、`targetSizeMatches=true`、`sameFilesystemDevice=false`。
- staged 目录内 `sha256sum -c gateway-mysql-20260604-134239.sql.sha256` 返回 `OK`。

仍未完成：选择真实 off-host target、配置私有凭据或挂载、部署 timer、执行生产 restore rehearsal。

## 2026-06-06 首发优惠/推荐奖励与 off-host backup 推进决策

用户明确：Docker 正式切换先不用推；可以继续推进：

1. 首发优惠 + 自动推荐奖励上线包。
2. 真实 off-host backup + restore rehearsal。

当前状态：

- Gateway 本地已实现首发套餐和 referral 后端：`launch-pro-monthly` 29 元/600 点、`launch-max-monthly` 69 元/1500 点；`GET /v1/referrals/me`；`POST /v1/orders` 可接 `referralCode`；激活首单付费订单后按规则发 100 点，推荐人每自然月最多 500 点。默认 `GUGU_REFERRAL_ENABLED=0`。
- 客户端分支 `fix/bug-from-master` 已补订阅页“复制邀请链接”入口，经本地 `/api/billing/referral` 代理 gateway，不暴露设备 token；仅当 gateway 返回 `enabled=true` 时显示。
- 新增 `docs/runbooks/gateway-launch-referral-rollout.md`，记录生产上线顺序：代码先带 `GUGU_REFERRAL_ENABLED=0` 部署；先让首发价生效；再做 MySQL migration `deploy/mysql/002-referrals.sql`；验证后再小窗口打开 referral flag。
- 新增/更新 `docs/runbooks/gateway-offhost-backup-runbook.md`，明确下一次 off-host backup 执行需要真实目标路径/凭据、target label、不同 filesystem device 确认、scratch MySQL restore URL。
- 本线程尝试生产 read-only SSH 到 `root@139.196.214.54`，但返回 `Permission denied (publickey...)`，因此没有执行生产 preflight、没有上传/部署、没有执行真实 off-host staging 或 restore rehearsal。

关键上线边界：

- 不要在 MySQL migration 002 验证前打开 `GUGU_REFERRAL_ENABLED=1`。
- 首发价套餐不受 referral flag 控制；gateway 代码部署后 `/buy` 会直接展示首发价。
- off-host backup 如果 target 仍和 `/var/backups/gugu-gateway` 同盘，只能算 staging/rehearsal，不算灾备。
- 主 Agent 打包整体测试完成前，不要开启 referral 灰度。

## 2026-06-06 18:22-18:32 CST 首发优惠/推荐奖励生产部署

生产仍保持 `/root/opt/gugu` + systemd，未切 Docker。使用用户提供的 SSH key 完成 archive 部署：

- 部署 commit：gateway `c20c6a3 feat: add launch referrals`。
- 部署前 preflight：`gugu-gateway`、`mysqld`、`redis` 均 `active`；local/public `/health` 均 `{"ok":true}`；`GUGU_STORE_DRIVER=mysql`，`GUGU_MAINTENANCE_DISABLE_WRITES=0`，附件 task Redis 灰度仍为 `GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`。
- 部署前确认最新自动备份 `gateway-mysql-20260606-033555.sql` sha256 OK。
- 部署前即时 MySQL 备份成功：`/var/backups/gugu-gateway/gateway-mysql-20260606-182454.sql`，`ok=true`，表计数：devices 29、activation_codes 20、usage_events 2856、orders 42、payment_notifications 2。`mysqldump` 因 app user 权限不足 fallback 到 JS logical dump，最终备份成功。
- 归档部署时间戳：`20260606182730`。保留回滚目录：
  - `/root/opt/gugu-prev-launch-referral-20260606182730`
  - `/root/opt/gugu-backups/gugu-before-launch-referral-20260606182730`
- 部署后 local/public `/health` 均 OK；service log 只有预期的 SIGTERM stop/start 和新进程 listen，无启动错误。
- 生产 `.env` 已显式保持 referral 灰度关闭：
  - `GUGU_REFERRAL_ENABLED=0`
  - `GUGU_REFERRAL_REWARD_CREDITS=100`
  - `GUGU_REFERRAL_MONTHLY_CAP=500`
- `/buy` 已显示首发文案和 `launch-pro-monthly`、`launch-max-monthly`；`/checkout?packageId=launch-pro-monthly` 显示 Pro 首发月和 600 点。
- 已执行 MySQL migration `deploy/mysql/002-referrals.sql`，guard 输出 `applied=yes`；`orders.referral_code`、`referral_codes`、`referral_rewards`、`gateway_schema_migrations version=002` 均存在。
- 部署后 `mysql-schema-check` 返回 `ok=true`，MySQL 8.4.9，`missingTables=[]`，`missingIndexes=[]`。
- 部署后即时 MySQL 备份成功：`/var/backups/gugu-gateway/gateway-mysql-20260606-183102.sql`，sha256 OK，表计数同上。
- 部署后 `gateway-alert-check` 返回 `ok=true`、`issues=[]`，并识别最新 post-migration backup。
- 手动触发 `gugu-gateway-monitor.service` 成功，journal 中 `issues=[]`；timers 仍包含 alert、monitor、mysql-backup。

下一步：主 Agent 打包/整体测试通过后，可以选择一个很小的窗口把 `GUGU_REFERRAL_ENABLED=1` 打开并只做 referral 灰度；Docker 仍不动。off-host backup 仍缺真实 target/凭据和 restore rehearsal。

## 2026-06-06 18:37-18:43 CST referral 灰度开启

用户确认主 Agent 已打包，继续推进 referral 灰度；Docker 仍未切换。

- 开启前 preflight：`gugu-gateway` active，public `/health` OK，`gateway-alert-check` `ok=true`、`issues=[]`，最新备份 `gateway-mysql-20260606-183102.sql` sha OK。
- 开启前即时备份成功：`/var/backups/gugu-gateway/gateway-mysql-20260606-183755.sql`，`ok=true`，表计数 devices 29、activation_codes 20、usage_events 2856、orders 42、payment_notifications 2。
- `.env` 已切换：
  - `GUGU_REFERRAL_ENABLED=1`
  - `GUGU_REFERRAL_REWARD_CREDITS=100`
  - `GUGU_REFERRAL_MONTHLY_CAP=500`
- 开启前 env 备份：`/root/opt/gugu/.env.referral-enable-20260606183756.bak`，内容确认 `GUGU_REFERRAL_ENABLED=0`。另有一次因本地 PowerShell 展开导致的同内容备份 `/root/opt/gugu/.env.referral-enable-.bak`。
- 脱敏 referral smoke 结果：
  - 新建 ops 免费 smoke 设备：`enabled=true`、`eligible=false`、无 code/url。
  - 现有付费设备：`enabled=true`、`eligible=true`、`hasCode=true`、`hasInviteUrl=true`、`rewardCredits=100`、`monthlyCapCredits=500`、`remainingAwardCreditsThisMonth=500`。脚本未打印 token/code/url。
- 当前 referral 表计数：`referral_codes=1`、`referral_rewards=0`。尚未发生真实好友首单激活发奖。
- 开启后即时备份成功：`/var/backups/gugu-gateway/gateway-mysql-20260606-184213.sql`，sha OK，table counts devices 32、activation_codes 20、usage_events 2856、orders 42、payment_notifications 2。devices 增量来自 ops smoke 注册。
- 开启后 public `/health` OK，`gateway-alert-check` `ok=true`、`issues=[]`，手动 `gugu-gateway-monitor.service` 成功且 `issues=[]`。

快速关闭 referral：恢复 `.env.referral-enable-20260606183756.bak` 或将 `GUGU_REFERRAL_ENABLED=0` 写回 `.env` 后 `systemctl restart gugu-gateway`，再检查 local/public health 和 alert/monitor。

## 2026-06-06 18:50-19:05 CST off-host backup probe、restore rehearsal 与 referral 真实订单观察

用户要求先做 off-host backup + restore rehearsal，再观察推荐真实订单；Docker 仍不切。

off-host 目标探测结论：

- 生产只读检查显示 `/var/backups/gugu-gateway`、`/mnt`、`/data`、`/var/lib/mysql`、`/var/lib/redis` 仍在同一块根盘 `/dev/nvme0n1p3` 上。
- `/mnt` 当前为空；`/etc/gugu-gateway` 仅有 `mysql.env`、`redis.env`，没有 off-host target env、挂载凭据或对象存储配置。
- 因此“真实 off-host backup”仍未完成：当前没有独立磁盘、NAS、对象存储挂载、rsync 目的地或已批准的上传 job。不要把同盘目录误记为灾备。

restore rehearsal 结果：

- 使用最新本地备份 `/var/backups/gugu-gateway/gateway-mysql-20260606-184213.sql` 做 scratch restore rehearsal。
- 临时创建 scratch DB `gugu_gateway_restore_20260606` 和临时 restore 用户，只授予该 scratch DB 权限。
- `mysql-restore-check.ts` 返回 `ok=true`、`countMismatches=[]`、`issues=[]`。
- 关键表计数：devices 32、activation_codes 20、usage_events 2856、orders 42、payment_notifications 2。
- 演练后已清理 scratch DB、临时 restore 用户和 `/tmp` 下的临时脚本；清理检查返回 `scratchDatabaseCount=0`、`restoreUserCount=0`。

referral 真实订单观察基线：

- 当前 `orders_with_referral_code=0`、`referral_rewards_total=0`、`referral_rewards_awarded=0`、`referral_rewards_rejected=0`、`referral_codes_total=1`。
- 已创建当前线程 heartbeat 观察任务“观察推荐真实订单”：每 2 小时只读检查一次，持续约 24 小时；只报告 referral 订单/奖励变化和异常，不打印 token、license、完整推荐码或设备 id。

下一步边界：如需完成真正 off-host backup，需要用户或运维提供独立 off-host target 和凭据/挂载方式；在此之前只能算本地备份 + restore 演练通过。referral 下一阶段是等待第一笔真实带 `referral_code` 的订单付款并激活，确认双方各加 100 点且幂等不重复发奖。

## 2026-06-04 运维交接文档

新增 `docs/runbooks/gateway-ops-handoff.md`，面向运维接手人，覆盖当前生产事实、日常巡检、预警面板、admin metrics、备份恢复、常见事件处理、Docker 状态、扩容路线、交接清单和 30 秒口头版。该文档不包含真实 token 或密钥。

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
3. attachment async task 继续按三段灰度：
   - 已完成：代码部署但 `GUGU_ATTACHMENT_TASKS_ENABLED=0`，确认桌面回退同步解析。
   - 已完成：小流量打开 `GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=0`，production smoke 验证创建、轮询、失败路径、spool 删除和 metrics。
   - 已完成：打开 `GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`，验证 `backend=redis`、`fallbackActive=false`、Redis task key 写入和 spool 清理。
   - 已完成：Redis task 24h+ 观察，`fallbackActive=false`、队列不堆积、spool 无残留、alert/monitor 无 issue。
4. DeepSeek V4 多模态接入时，把 worker/provider 从 `glm` 平滑扩展到 `deepseek-v4`，不要改客户端 task 协议。
5. 再做生产目录规范化：`/opt/gugu-gateway`、`/etc/gugu-gateway/gateway.env`、非 root `gugu` 用户。
6. Docker、多实例、SLB/Nginx 多后端放最后，等单机指标和真实压力证明需要再推进。

## 给下一位 gateway agent 的 prompt

请从 `docs/runbooks/gateway-agent-handoff-2026-05-29.md` 接手 gateway。当前生产在 `139.196.214.54`，运行目录 `/root/opt/gugu`，服务 `gugu-gateway.service`，MySQL `gugu_gateway` 已是 active store，Redis limiter/circuit 已启用，微信和支付宝真实支付已验证。Phase 2 alert check 已部署到生产并由 `gugu-gateway-alert.timer` 每 5 分钟运行；用户已决定跳过外部 webhook 配置，因此先依赖 journald JSON 和 systemd failure。Phase 4 attachment task 已完成 Redis metadata/status/lease 小流量灰度和 24h+ 观察：`GUGU_ATTACHMENT_TASKS_ENABLED=1`、`GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1`，admin metrics 应显示 `attachmentTasks.enabled=true`、`redisEnabled=true`、`backend=redis`、`fallbackActive=false`。Phase 5A-5E 已完成准备：本地 Docker 沙盒、Compose 自动验收、gateway-only 切换/回滚 runbook、生产 Docker readiness、预警面板、真实存储 map、扩容路线、运维交接、off-host backup staging/verify 脚本和 runbook；生产尚未切 Docker，也未连接真实 off-host backup target。不要把用户附件 payload 放 OSS；单机阶段仍只用本机私有 spool `/var/lib/gugu-gateway/attachment-tasks`。下一步优先选择真实 off-host backup target 并做一次生产 restore rehearsal，或继续 DeepSeek V4 provider-neutral worker 扩展；不要马上推进多实例或 OSS。DeepSeek V4 多模态后续会上线，task 协议必须保持 provider-neutral。
