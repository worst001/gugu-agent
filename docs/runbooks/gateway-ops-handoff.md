# Gugu Gateway 运维交接手册

状态：运维交接草案，基于 `2026-06-04` 生产只读检查和 Phase 1-5E 准备结果。

这份文档给接手运维的人看。目标不是解释所有代码，而是让你知道：

- 当前线上到底跑在哪里；
- 每天该看什么；
- 出问题先查什么；
- 哪些动作可以做，哪些动作不要碰；
- Docker、扩容、异地备份目前准备到哪一步。

## 1. 当前生产事实

生产机器：

```text
Host: 139.196.214.54
OS: Alibaba Cloud Linux 3
Gateway runtime dir: /root/opt/gugu
Gateway service: gugu-gateway.service
Gateway local port: 127.0.0.1:18787
Public domain: https://gugu.guxingyao.com
```

核心组件：

| 组件 | 当前形态 | 监听/位置 | 说明 |
| --- | --- | --- | --- |
| Nginx | 宿主机 systemd | `0.0.0.0:80/443` | 对外 HTTPS 入口 |
| Gateway | 宿主机 systemd + Bun | `127.0.0.1:18787` | 当前正式生产入口 |
| MySQL | 宿主机 systemd | `127.0.0.1:3306` | 主业务数据源 |
| Redis | 宿主机 systemd | `127.0.0.1:6379` | 限流、熔断、task metadata/lease |
| Backup | systemd timer | `/var/backups/gugu-gateway` | MySQL SQL + manifest + sha256 |
| Docker | 已安装，未承载 gateway 生产流量 | `/var/lib/docker` | 目前已有其他业务容器 |

重要结论：

- 生产还没有切 Docker。
- Docker 沙盒、Compose 预演、gateway-only 切换预案已经准备好。
- MySQL/Redis 不要和 gateway runtime 在同一个窗口一起迁移。
- 当前备份是本机备份，不等于异地灾备。

## 2. 绝对不要做的事

不要执行这些动作，除非有明确维护窗口和回滚方案：

- 不要 `docker prune`，机器上已有非 gateway 容器。
- 不要删除 `/var/backups/gugu-gateway`。
- 不要删除 `/root/opt/gugu`、`/var/lib/mysql`、`/var/lib/redis`、`/var/lib/gugu-gateway`。
- 不要把 `.env`、支付证书、API key 打印到日志或提交到 git。
- 不要直接把生产从 systemd 切 Docker。
- 不要同时迁 MySQL/Redis 和 gateway runtime。
- 不要把用户附件 payload 放到公开 OSS 或公共下载桶。
- 不要只改 `GUGU_STORE_DRIVER=sqlite` 试图回滚数据库。

## 3. 日常巡检

每天看一遍即可，遇到发布、支付异常、用户增长时加密频率。

### 服务状态

```bash
systemctl is-active gugu-gateway
systemctl is-active mysqld
systemctl is-active redis
systemctl is-active gugu-gateway-alert.timer
systemctl is-active gugu-gateway-monitor.timer
systemctl is-active gugu-gateway-mysql-backup.timer
```

期望全部是：

```text
active
```

### Health

```bash
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
```

期望：

```json
{"ok":true}
```

### Timer

```bash
systemctl list-timers 'gugu-gateway*' --no-pager
```

重点：

- `gugu-gateway-alert.timer` 每 5 分钟。
- `gugu-gateway-monitor.timer` 每 5 分钟。
- `gugu-gateway-mysql-backup.timer` 每天凌晨 03:35 左右。

### 备份

```bash
latest=$(ls -1t /var/backups/gugu-gateway/gateway-mysql-*.sql | head -1)
ls -l "$latest" "$latest.manifest.json" "$latest.sha256"
cd /var/backups/gugu-gateway
sha256sum -c "$(basename "$latest").sha256"
```

期望：

```text
gateway-mysql-YYYYMMDD-HHMMSS.sql: OK
```

### 资源

```bash
uptime
free -m
df -h / /var /var/backups/gugu-gateway
docker system df
```

当前基线：

- 根盘约 `41%` 使用。
- 可用内存约 `1.5GiB`。
- `/var/lib/docker` 约 `5.3G`。
- `/var/lib/mysql` 约 `218M`。
- `/var/backups/gugu-gateway` 约 `10M`。

## 4. 预警面板

当前还没有外部 webhook，用户已决定跳过。因此预警面是：

- `gugu-gateway-alert.timer`
- `gugu-gateway-monitor.timer`
- systemd failure state
- journald JSON

详细面板定义见：

```text
docs/runbooks/gateway-warning-dashboard.md
```

核心告警信号：

| 信号 | 正常 | 需要处理 |
| --- | --- | --- |
| health | `ok=true` | local 或 public health 失败 |
| alert | `ok=true issues=[]` | 任意 issue |
| monitor | `ok=true issues=[]` | 支付/订单 issue |
| backup | age <30h 且 sha OK | 备份缺失、超龄、sha mismatch |
| Redis fallback | `fallbackActive=false` | fallback 持续 true |
| queue | queued/running 不堆积 | waiting 接近上限或长时间不清 |
| disk | root disk <70% | >70% 警惕，>80% 紧急 |
| Docker | 用量稳定 | images/volumes 异常增长 |

查看 alert：

```bash
journalctl -u gugu-gateway-alert.service -n 120 --no-pager
```

查看 monitor：

```bash
journalctl -u gugu-gateway-monitor.service -n 120 --no-pager
```

## 5. Admin Metrics

不要打印 token。用环境变量加载后访问：

```bash
set -a
. /root/opt/gugu/.env
set +a
curl -fsS -H "Authorization: Bearer ${GUGU_ADMIN_TOKEN}" \
  http://127.0.0.1:18787/admin/api/metrics
```

重点字段：

```text
attachmentTasks.enabled=true
attachmentTasks.redisEnabled=true
attachmentTasks.backend=redis
attachmentTasks.fallbackActive=false
attachmentTasks.queued=0
attachmentTasks.running=0
circuits.deepseek.backend=redis
circuits.deepseek.fallbackActive=false
circuits.glm.backend=redis
circuits.glm.fallbackActive=false
```

如果 Redis fallback 变成 true：

1. 先看 Redis 是否 active。
2. 看 gateway 日志是否有 Redis timeout/error。
3. 不要立即重启所有服务。
4. 若 Redis 恢复后 fallback 仍不恢复，再考虑重启 gateway。

## 6. 备份与恢复

当前本地备份已工作：

```text
/var/backups/gugu-gateway/gateway-mysql-*.sql
/var/backups/gugu-gateway/gateway-mysql-*.sql.manifest.json
/var/backups/gugu-gateway/gateway-mysql-*.sql.sha256
```

本地备份检查：

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/gateway-alert-check.ts \
  --env-file /root/opt/gugu/.env \
  --backup-dir /var/backups/gugu-gateway
```

异地备份准备已完成，但还未接真实目标：

```text
docs/runbooks/gateway-offhost-backup-runbook.md
gateway/scripts/mysql-offhost-stage.ts
gateway/deploy/env/offhost-backup.env.example
```

上线 Docker 前，建议先完成：

1. 选择私有 off-host target。
2. 配置 `/etc/gugu-gateway/offhost-backup.env`。
3. 手动 stage 最新备份。
4. 从 off-host 副本 restore 到 scratch MySQL。
5. restore check 返回 `ok=true`。
6. 再启用 off-host timer。

## 7. 常见事件处理

### Gateway health 失败

```bash
systemctl status gugu-gateway --no-pager -l
journalctl -u gugu-gateway -n 200 --no-pager
systemctl is-active mysqld
systemctl is-active redis
```

如果是最近发布导致：

- 不要先动 MySQL。
- 优先按发布回滚或重启 gateway。
- 回滚前确认最新 MySQL backup。

### Public health 失败但 local health 正常

优先查 Nginx/TLS：

```bash
systemctl status nginx --no-pager -l
journalctl -u nginx -n 200 --no-pager
nginx -t
```

### MySQL 异常

```bash
systemctl status mysqld --no-pager -l
journalctl -u mysqld -n 200 --no-pager
df -h /
```

不要把 `GUGU_STORE_DRIVER` 改回 sqlite。

### Backup 失败

```bash
journalctl -u gugu-gateway-mysql-backup.service -n 200 --no-pager
df -h /var/backups/gugu-gateway
systemctl is-active mysqld
```

手动补一次：

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-backup.ts \
  --env-file /root/opt/gugu/.env \
  --backup-dir /var/backups/gugu-gateway
```

### 支付/订单 monitor 报 issue

先看 monitor JSON 里的 `issues`，再看最近订单和 notification。不要直接改数据库。

```bash
journalctl -u gugu-gateway-monitor.service -n 200 --no-pager
```

如涉及真实支付，优先保守处理：

- 暂停新订单；
- 保留支付回调日志；
- 对照支付平台后台；
- 必要时走补偿脚本或人工补发，不要手改多张表。

## 8. Docker 状态

已完成准备：

- Phase 5A：本地 Docker 沙盒。
- Phase 5B：Compose 自动验收。
- Phase 5C：gateway-only Docker 切换/回滚 runbook。
- Phase 5D：生产 Docker readiness、预警面板、扩容/存储/交接。
- Phase 5E：off-host backup staging/verify 准备。

生产尚未切 Docker。

相关文档：

```text
gateway/deploy/docker/README.md
docs/runbooks/gateway-docker-cutover-runbook.md
docs/runbooks/gateway-phase5d-production-readiness.md
```

如果未来要切 Docker，第一步只能切 gateway-only：

- gateway 入容器；
- MySQL 仍宿主机；
- Redis 仍宿主机；
- Nginx 仍宿主机；
- 备份目录仍宿主机；
- 证书和支付密钥仍宿主机。

不要一口气 full-stack Docker。

## 9. 扩容路线

扩容顺序：

1. 垂直扩容：加机器规格/磁盘。
2. gateway-only Docker：仍单实例。
3. 同机多 gateway 实例：Nginx 多 upstream，端口分开。
4. 数据面拆分：MySQL/RDS、Redis 独立或托管。
5. K8s：复用 Docker image，重新写 Deployment/Service/Secret/CronJob。

多实例前必须解决：

- Redis limiter/circuit/task metadata 正常。
- MySQL 连接数。
- attachment task payload storage。当前本机 spool 不适合多实例随机调度。
- Nginx upstream health。
- 备份和恢复演练。

## 10. 运维交接清单

接手人需要拿到：

- 服务器 SSH 权限。
- Nginx 域名/TLS 管理权限。
- `/root/opt/gugu/.env` 的读取权限，但不要外传。
- `/etc/gugu-gateway` 的权限。
- MySQL 管理/只读排查权限。
- Redis 排查权限。
- 备份目标权限。
- 支付平台后台权限，至少能查交易。

接手人需要读完：

```text
docs/runbooks/gateway-agent-handoff-2026-05-29.md
docs/runbooks/gateway-systemd-mysql-redis.md
docs/runbooks/gateway-warning-dashboard.md
docs/runbooks/gateway-phase5d-production-readiness.md
docs/runbooks/gateway-docker-cutover-runbook.md
docs/runbooks/gateway-offhost-backup-runbook.md
```

交接当天要一起做一次：

1. 跑服务状态检查。
2. 看 `/health` local/public。
3. 看最新 backup sha。
4. 看 alert/monitor journal。
5. 看 admin metrics 的 Redis fallback。
6. 找到真实数据目录。
7. 说明哪些文件不能打印。
8. 演示一次“如果 gateway 挂了怎么回滚/重启”。
9. 明确谁批准生产变更。

## 11. 30 秒口头版

这台 gateway 当前是单机生产，Nginx 对外，Bun gateway 本地 `18787`，MySQL 是主数据，Redis 做限流/熔断/task 状态。systemd timer 已经有 health/payment monitor 和 MySQL backup。Docker 已准备好但还没切生产，未来第一步只能 gateway-only，不动 MySQL/Redis。当前最大缺口是 off-host backup 还没接真实目标。日常看 health、timer、backup sha、Redis fallback、磁盘和支付 monitor；任何数据库、备份、Docker prune、生产切换都要有维护窗口和回滚方案。
