# Gateway Phase 5D Production Readiness

Status: prepared on 2026-06-04, no production cutover executed.

Phase 5D answers the questions that should be clear before any formal Docker
cutover: whether the production host can run Docker, where the real data lives,
what warning dashboard operators should watch, how to scale after cutover, and
how to hand the system to ops.

## Production Read-Only Findings

Checked at `2026-06-04T21:30-21:31+08:00`.

Host:

- OS: Alibaba Cloud Linux 3 (Soaring Falcon), kernel
  `5.10.134-16.1.al8.x86_64`.
- CPU/memory: Docker reports `2` CPUs and `3.5GiB` memory.
- Uptime/load: `129 days`, load average `0.15/0.08/0.04`.
- Memory: `3.5GiB` total, about `1.55GiB` available, swap about `3.5GiB`
  available.
- Root disk: `/dev/nvme0n1p3`, ext4, `40G` total, `16G` used, `22G`
  available, `41%` used.

Docker:

- Installed: `/usr/bin/docker`.
- Docker Engine: `26.1.3`.
- Docker Compose plugin: `v2.27.0`.
- Docker service: `active`.
- Docker storage driver: `overlay2`, backing filesystem `extfs`.
- Docker cgroup driver/version: `cgroupfs`, cgroup v1.
- Docker root dir: `/var/lib/docker`.
- Docker current usage: `/var/lib/docker` about `5.3G`; `docker system df`
  reports images `1.854GB`, local volumes `878.1MB`.
- Existing Docker workloads are present: 9 running containers, including Taiga,
  RabbitMQ, Postgres, and an Nginx container. Do not run Docker prune without
  identifying owners.

Gateway services and ports:

- `gugu-gateway`, `mysqld`, `redis`, `gugu-gateway-alert.timer`,
  `gugu-gateway-monitor.timer`, and `gugu-gateway-mysql-backup.timer` are
  `active`.
- Nginx listens on `0.0.0.0:80` and `0.0.0.0:443`.
- Bun gateway listens on `127.0.0.1:18787`.
- MySQL listens on `127.0.0.1:3306`.
- Redis listens on `127.0.0.1:6379`.
- Local health returns `{"ok":true}`.

Current timer state:

- `gugu-gateway-alert.timer` runs every 5 minutes.
- `gugu-gateway-monitor.timer` runs every 5 minutes.
- `gugu-gateway-mysql-backup.timer` next run is around `03:35 CST`.

## Real Storage Map

All observed production paths are currently on the same root disk
`/dev/nvme0n1p3`. There is no separate mounted data disk or offline backup
target visible from the checked paths.

| Data | Current path | Owner/mode observed | Size observed | Notes |
| --- | --- | --- | --- | --- |
| Gateway code/runtime | `/root/opt/gugu` | `root:root` | `8.7M` | Current systemd app tree, not a git checkout |
| Gateway env | `/root/opt/gugu/.env` | not printed | not printed | Contains secrets; do not cat in logs |
| Gateway config dir | `/etc/gugu-gateway` | `root:root`, `0700` | small | Exists; `/etc/gugu-gateway/secrets` not observed in `ls -ld` output |
| Gateway runtime data | `/var/lib/gugu-gateway` | `root:root` | `4.7M` | Attachment task spool lives here |
| Attachment task spool | `/var/lib/gugu-gateway/attachment-tasks` | `root:root`, `0700` | empty at prior checks | Local private spool only |
| MySQL data | `/var/lib/mysql` | `mysql:mysql` | `218M` | Host MySQL remains source of truth |
| Redis data | `/var/lib/redis` | `redis:redis` | `8K` | Redis is transient coordination |
| Gateway backups | `/var/backups/gugu-gateway` | `root:root` | `10M` | SQL + manifest + sha256, 7-day retention |
| Docker root | `/var/lib/docker` | `root:root` | `5.3G` | Existing non-gateway workloads present |
| Logs | `/var/log` | mixed | `1.8G` | Include system and Nginx logs |

Storage conclusion:

- Hot data currently lives on one root disk.
- MySQL backups exist locally, but local backups are not offline or disaster
  recovery by themselves.
- Before production Docker cutover, decide whether to add:
  - ECS disk snapshots,
  - encrypted off-host backup copy,
  - private OSS/cold bucket for backup archives,
  - or a managed MySQL/RDS migration plan.

Minimum offline backup policy before higher-risk cutovers:

- Keep local `/var/backups/gugu-gateway` for fast restore.
- Copy daily MySQL SQL + manifest + sha256 to a private off-host location.
- Retain at least 7 daily, 4 weekly, and 3 monthly points once user growth
  makes data loss expensive.
- Test restore from the off-host copy quarterly or before major infra changes.

## Warning Dashboard Readiness

Dashboard spec: `docs/runbooks/gateway-warning-dashboard.md`.

Current alert surface:

- `gugu-gateway-alert.timer` every 5 minutes.
- `gugu-gateway-monitor.timer` every 5 minutes.
- journald JSON and systemd failure state.
- external webhook remains intentionally skipped by user decision.

Panels/operators should watch:

- local/public health,
- systemd service state,
- alert/monitor issues,
- backup freshness and sha,
- Redis circuit/task fallback,
- queue waiting/running,
- recent 5xx/429,
- host disk/memory/load,
- Docker storage growth.

Before a Docker cutover, run the dashboard snapshot commands and require green
state for health, backup, monitor, and Redis fallback.

## Scaling Plan After Formal Cutover

The safe order is capacity first, then runtime scaling, then data-plane scaling.

### Step 1: Vertical Headroom

Trigger:

- sustained CPU/load pressure,
- available memory below `1GiB`,
- root disk above `70%`,
- Docker storage growing faster than retention can explain.

Action:

- increase ECS size or disk,
- keep one gateway instance,
- keep MySQL/Redis on host unless there is a separate data migration plan.

### Step 2: Gateway-Only Docker Cutover

Use `docs/runbooks/gateway-docker-cutover-runbook.md`.

Properties:

- one gateway container,
- host MySQL and Redis,
- host Nginx,
- host backups and secrets,
- rollback to systemd gateway.

### Step 3: Same-Host Multiple Gateway Instances

Do not use `network_mode: host` for multiple gateway containers on the same
host. Use separate host ports such as `18787`, `18788`, and `18789`, then make
Nginx upstream balance across them.

Prerequisites:

- Redis limiter/circuit active and `fallbackActive=false`.
- MySQL connection pool and `max_connections` reviewed.
- Attachment task payload storage solved. Current local spool is not safe for
  multi-instance async task workers unless requests are sticky to the worker
  instance or payload moves to shared private storage.
- Nginx upstream health/failover tested.

Recommended rule:

- For message-only scaling, multiple gateway instances are feasible sooner.
- For attachment async task scaling, first solve shared private payload storage
  or pin task workers to the instance that owns the spool file.

### Step 4: Split Data Plane

Move strong data before many app replicas:

- MySQL -> managed RDS or a dedicated database host.
- Redis -> managed Redis or a dedicated Redis host.
- Backups -> off-host copy plus restore drill.
- Secrets -> private secret store or root-owned env files with strict mode.

### Step 5: K8s

K8s should reuse the Docker image, not the Compose file directly.

Mapping:

- gateway image -> `Deployment`,
- gateway env -> `ConfigMap` + `Secret`,
- healthcheck -> readiness/liveness probes,
- backup/alert jobs -> `CronJob`,
- host Nginx/SLB -> `Service`/Ingress,
- MySQL -> managed database preferred,
- Redis -> managed Redis preferred,
- attachment payload -> private object storage or shared volume with TTL.

## Operations Handoff

Owner responsibilities:

- Product owner decides maintenance windows and user-facing downtime.
- On-call engineer executes runbooks and validates dashboard state.
- Ops owner maintains Docker, disk, backups, systemd timers, Nginx, and secrets.
- Developer owner maintains gateway code, schema compatibility, and smoke tests.

Daily checks:

- alert and monitor timers are active and recent,
- `/health` local/public OK,
- latest backup age and sha OK,
- root disk below `70%`,
- Redis fallback inactive.

Weekly checks:

- review backup retention and restore metadata,
- inspect Docker disk usage and existing non-gateway containers,
- review 5xx/429 trends,
- confirm payment notifications and fulfilled orders remain sane.

Before any deployment:

- run read-only preflight,
- confirm latest backup and sha,
- keep rollback command ready,
- do not change MySQL/Redis storage in the same window as gateway runtime unless
  the specific data migration runbook says so.

Handoff packet for ops:

- `docs/runbooks/gateway-agent-handoff-2026-05-29.md`,
- `docs/runbooks/gateway-docker-cutover-runbook.md`,
- `docs/runbooks/gateway-warning-dashboard.md`,
- `docs/runbooks/gateway-phase5d-production-readiness.md`,
- `gateway/deploy/docker/README.md`,
- `gateway/deploy/docker/compose.gateway-only.example.yaml`,
- private server env files stored outside git.

## Phase 5A To 5D Review

- Phase 5A: local Docker sandbox completed. `Dockerfile`, `compose.yaml`,
  `.dockerignore`, local sandbox env, and README exist; local build/up/health,
  schema, Redis task smoke, backup, and alert check passed.
- Phase 5B: Compose rehearsal assets completed. `docker-sandbox-check` runs the
  local gate, and single-host full-stack Compose example exists for future
  rehearsal.
- Phase 5C: production gateway-only Docker cutover plan completed. It is
  gateway-only by design and keeps host MySQL/Redis/Nginx unchanged.
- Phase 5D: production readiness, warning dashboard, storage map, scaling plan,
  and ops handoff prepared. Production Docker conditions are read-only verified:
  Docker/Compose exist and the daemon is active. Production has not been cut to
  Docker.

Recommended next state:

- Do not cut production yet.
- Add off-host backup policy before high-risk infrastructure changes. Phase 5E
  prepared `mysql-offhost-stage` and the off-host backup runbook, but a real
  off-host target still needs to be chosen and connected.
- Keep observing real traffic and prepare DeepSeek V4 provider/worker extension
  separately from Docker.
