# Gateway Warning Dashboard

Status: Phase 5D draft, ready for current journald/admin-metrics operation and
future Grafana mapping.

This dashboard is intentionally small. It is for catching production risk before
a Docker cutover or during the first observation window. The current data
sources are existing gateway admin metrics, systemd timer journals, backup
manifests, and host read-only commands. A later Prometheus/Grafana stack can map
the same panels to scraped metrics.

## Data Sources

- Gateway health: `http://127.0.0.1:18787/health`.
- Gateway admin metrics: `http://127.0.0.1:18787/admin/api/metrics` with
  `GUGU_ADMIN_TOKEN`.
- Alert check JSON: `gugu-gateway-alert.service` journal.
- Payment/health monitor JSON: `gugu-gateway-monitor.service` journal.
- Backup manifest and sha: `/var/backups/gugu-gateway/gateway-mysql-*.sql*`.
- Host resources: `uptime`, `free -m`, `df -h`, `docker system df`.
- Service state: `systemctl is-active ...`.

## Overview Panels

| Panel | Source | Green | Warning | Critical | Action |
| --- | --- | --- | --- | --- | --- |
| Gateway health | `/health` | `ok=true` | one transient failure | repeated failure | Check gateway logs, rollback if after deploy |
| Public health | `https://gugu.guxingyao.com/health` | `ok=true` | local OK but public failing | public failing >2 checks | Check Nginx/TLS/upstream |
| Service state | `systemctl is-active` | gateway/mysql/redis active | one timer inactive | gateway/mysql/redis inactive | Start incident, inspect unit journal |
| Alert timer | `gugu-gateway-alert.service` | `ok=true issues=[]` | webhook skipped or old run | any issue or failed unit | Follow issue code in alert JSON |
| Monitor timer | `gugu-gateway-monitor.service` | `ok=true issues=[]` | old run | payment/order issue | Inspect recent orders/notifications |
| Latest backup | manifest + sha | age <30h and sha OK | age 24-30h | age >30h or sha mismatch | Run backup, verify sha, check disk |
| Redis backend | admin metrics | backend `redis`, fallback false | fallback true once | fallback true persists | Inspect Redis, consider conservative fallback |
| Attachment task queue | admin metrics | queued=0, running=0 after smoke | queued >0 for >5m | queued near limit or running stuck | Inspect worker logs/spool |
| Message/GLM queues | admin metrics | active below concurrency, waiting=0 | waiting >0 briefly | waiting near limit | Check upstream latency/rate limits |
| 5xx errors | admin metrics/logs | 0 recent 5xx | 1 transient | repeated 5xx | Inspect request errors and upstream |
| 429 errors | admin metrics | under expected burst | grows above baseline | sustained user impact | Check traffic/load/rate limits |
| Host saturation | `uptime/free/df` | load <1, disk <70%, available mem >1GiB | disk 70-80% or mem <1GiB | disk >80% or mem <512MiB | Clean logs/backups only with approval |
| Docker storage | `docker system df` | stable, enough root free | images/volumes growing | root disk pressure | Do not prune blindly; identify owners |
| Off-host backup | off-host manifest | age <30h, sha OK, different device | age 24-30h or restore drill due | missing, sha mismatch, same-device target | Stage backup, verify target, run restore rehearsal |

## Current Manual Snapshot Commands

```bash
systemctl is-active gugu-gateway
systemctl is-active mysqld
systemctl is-active redis
systemctl is-active gugu-gateway-alert.timer
systemctl is-active gugu-gateway-monitor.timer
systemctl is-active gugu-gateway-mysql-backup.timer
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
```

Admin metrics:

```bash
set -a
. /root/opt/gugu/.env
set +a
curl -fsS -H "Authorization: Bearer ${GUGU_ADMIN_TOKEN}" \
  http://127.0.0.1:18787/admin/api/metrics
```

Alert and monitor journals:

```bash
journalctl -u gugu-gateway-alert.service -n 120 --no-pager
journalctl -u gugu-gateway-monitor.service -n 120 --no-pager
```

Backup:

```bash
latest=$(ls -1t /var/backups/gugu-gateway/gateway-mysql-*.sql | head -1)
ls -l "$latest" "$latest.manifest.json" "$latest.sha256"
cd /var/backups/gugu-gateway
sha256sum -c "$(basename "$latest").sha256"
```

Host and Docker:

```bash
uptime
free -m
df -h / /var /var/lib/docker /var/backups/gugu-gateway
docker system df
docker ps
```

Off-host backup after Phase 5E target is configured:

```bash
set -a
. /etc/gugu-gateway/offhost-backup.env
set +a
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-offhost-stage.ts \
  --out-dir "$GUGU_OFFHOST_BACKUP_DIR" \
  --target-label "$GUGU_OFFHOST_BACKUP_TARGET_LABEL" \
  --verify-only \
  --require-different-device
```

## Alert Routing

Current production intentionally skips external webhook configuration. Until a
webhook is enabled, the alert surface is:

- `gugu-gateway-alert.timer` every 5 minutes.
- systemd failure state if the alert process exits non-zero.
- journald JSON payloads for human inspection.

Suggested future routing:

- Critical: service down, backup sha mismatch, backup age over 30h, payment
  monitor issue, MySQL/Redis inactive.
- Warning: Redis fallback active, queue waiting, disk over 70%, Docker storage
  growing quickly, repeated 429 above expected traffic, off-host restore drill
  due.
- Critical: off-host backup missing for more than 30 hours, off-host sha
  mismatch, production target unexpectedly on the same filesystem device.
- Info: deploy/cutover start and end, Docker image tag changed, manual backup.

## Grafana Mapping

If Prometheus/Grafana is introduced later:

- Scrape gateway admin metrics through a small exporter or add a Prometheus
  endpoint.
- Use node exporter for CPU, memory, disk, filesystem, and network.
- Use cAdvisor or Docker exporter for container CPU/memory/restart/storage.
- Use blackbox exporter for public `/health`.
- Keep dashboards split into:
  - Executive status: health, orders, backup, user-facing errors.
  - On-call status: services, queues, circuits, backup, host saturation.
  - Docker/K8s status: image tag, restarts, resource use, probes.

Do not make high-cardinality metrics from device IDs, request IDs, order IDs, or
task IDs. Keep those in logs.
