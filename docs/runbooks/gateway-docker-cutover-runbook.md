# Gateway Docker Cutover Runbook

Status: Phase 5C draft, not executed in production.

This runbook intentionally starts with a gateway-only Docker cutover. MySQL,
Redis, Nginx, certificate files, backup directories, and payment secrets remain
on the host. Full-stack Docker or K8s is a later migration and must not be mixed
into this first maintenance window.

## Why Gateway-Only First

- It reuses the already healthy production MySQL and Redis stores.
- It avoids dumping/importing MySQL during the same window as the runtime cut.
- `network_mode: host` lets the container keep using `127.0.0.1` MySQL/Redis
  URLs and lets Nginx keep the same `127.0.0.1:18787` upstream.
- Rollback is just stopping Compose and starting `gugu-gateway.service` again.

Use `gateway/deploy/docker/compose.gateway-only.example.yaml` for this path.
Use `gateway/deploy/docker/compose.single-host.example.yaml` only for later
full-stack rehearsals that include a dedicated MySQL container.

## Preconditions

- Review `docs/runbooks/gateway-phase5d-production-readiness.md`.
- Confirm the warning dashboard in `docs/runbooks/gateway-warning-dashboard.md`
  is green.
- Current production is healthy:
  - `gugu-gateway`, `mysqld`, `redis` active.
  - local and public `/health` OK.
  - `gugu-gateway-alert.timer` and `gugu-gateway-monitor.timer` recent runs are
    `ok=true`, `issues=[]`.
  - Latest `/var/backups/gugu-gateway/gateway-mysql-*.sql` has matching
    `.manifest.json` and `.sha256`.
- Docker and Docker Compose are installed on the server.
- A rollback operator has shell access and the existing SSH key.
- No payment/provider incident is in progress.
- Real env and secret files have not been copied into git.

## Files To Prepare

Private server files:

```bash
/etc/gugu-gateway/gateway.docker.env
/etc/gugu-gateway/docker-compose.env
/etc/gugu-gateway/secrets/
/var/lib/gugu-gateway/
/var/backups/gugu-gateway/
```

`gateway.docker.env` should start from the current production gateway env. For
gateway-only Docker, keep MySQL and Redis pointed at host loopback because the
Compose service uses `network_mode: host`:

```bash
GUGU_GATEWAY_HOST=127.0.0.1
GUGU_GATEWAY_PORT=18787
GUGU_STORE_DRIVER=mysql
GUGU_MYSQL_URL=mysql://gugu_gateway_app:REPLACE_ME@127.0.0.1:3306/gugu_gateway
GUGU_REDIS_URL=redis://:REPLACE_ME@127.0.0.1:6379/0
GUGU_REDIS_LIMITER_ENABLED=1
GUGU_REDIS_CIRCUIT_ENABLED=1
GUGU_ATTACHMENT_TASKS_ENABLED=1
GUGU_REDIS_ATTACHMENT_TASKS_ENABLED=1
GUGU_ATTACHMENT_TASK_SPOOL_DIR=/var/lib/gugu-gateway/attachment-tasks
GUGU_ALERT_EXPECT_ATTACHMENT_TASKS_ENABLED=1
GUGU_ALERT_EXPECT_REDIS_ATTACHMENT_TASKS_ENABLED=1
```

`docker-compose.env` should contain only Compose substitution variables:

```bash
GUGU_GATEWAY_IMAGE_TAG=gateway-only-YYYYMMDDHHMM
GUGU_GATEWAY_ENV_FILE=/etc/gugu-gateway/gateway.docker.env
GUGU_GATEWAY_DATA_DIR=/var/lib/gugu-gateway
GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway
GUGU_GATEWAY_SECRETS_DIR=/etc/gugu-gateway/secrets
GUGU_GATEWAY_HOST=127.0.0.1
GUGU_GATEWAY_PORT=18787
```

## Read-Only Preflight

```bash
systemctl is-active gugu-gateway
systemctl is-active mysqld
systemctl is-active redis
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
systemctl list-timers 'gugu-gateway*' --no-pager
journalctl -u gugu-gateway-alert.service -n 80 --no-pager
journalctl -u gugu-gateway-monitor.service -n 80 --no-pager
```

Verify the newest backup before making any change:

```bash
latest=$(ls -1t /var/backups/gugu-gateway/gateway-mysql-*.sql | head -1)
ls -l "$latest" "$latest.manifest.json" "$latest.sha256"
cd /var/backups/gugu-gateway
sha256sum -c "$(basename "$latest").sha256"
```

Validate Compose shape without changing running services:

```bash
cd /root/opt/gugu
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml config
```

Build the image before the maintenance window:

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml build gateway
```

## Optional Container Dry-Run

Run one-off checks without starting the long-lived gateway container. These use
host networking and the Docker env file, but they should not bind the gateway
port:

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml \
  run --rm --no-deps gateway bun run mysql-schema-check
```

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml \
  --profile jobs run --rm gateway-backup
```

Do not run the long-lived `gateway` service while `gugu-gateway.service` is
still active, because both would bind `127.0.0.1:18787`.

## Cutover Window

1. Announce a short maintenance window.
2. Freeze risky public writes if the window overlaps payment traffic:

```bash
cp -a /etc/gugu-gateway/gateway.docker.env /etc/gugu-gateway/gateway.docker.env.pre-cutover-$(date +%Y%m%d%H%M%S).bak
sed -i 's/^GUGU_MAINTENANCE_MODE=.*/GUGU_MAINTENANCE_MODE=1/' /etc/gugu-gateway/gateway.docker.env
sed -i 's/^GUGU_MAINTENANCE_DISABLE_ORDERS=.*/GUGU_MAINTENANCE_DISABLE_ORDERS=1/' /etc/gugu-gateway/gateway.docker.env
sed -i 's/^GUGU_MAINTENANCE_DISABLE_WRITES=.*/GUGU_MAINTENANCE_DISABLE_WRITES=1/' /etc/gugu-gateway/gateway.docker.env
```

3. Take and verify a fresh backup:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-backup.ts --env-file /root/opt/gugu/.env --backup-dir /var/backups/gugu-gateway
latest=$(ls -1t /var/backups/gugu-gateway/gateway-mysql-*.sql | head -1)
cd /var/backups/gugu-gateway
sha256sum -c "$(basename "$latest").sha256"
```

4. Stop only the old gateway service. Keep MySQL and Redis running:

```bash
systemctl stop gugu-gateway
systemctl is-active mysqld
systemctl is-active redis
```

5. Start the containerized gateway:

```bash
cd /root/opt/gugu
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml up -d gateway
```

6. Validate:

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml ps
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
```

Admin metrics should still show:

```text
attachmentTasks.enabled=true
attachmentTasks.redisEnabled=true
attachmentTasks.backend=redis
attachmentTasks.fallbackActive=false
deepseek/glm circuit backend=redis
deepseek/glm circuit fallbackActive=false
```

7. Run the job-profile checks:

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml \
  --profile jobs run --rm gateway-alert
```

8. If all checks pass, unfreeze writes by restoring the intended maintenance
   flags in `gateway.docker.env`, then recreate the gateway container:

```bash
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml up -d --force-recreate gateway
```

9. Leave `gugu-gateway.service` stopped but not disabled for the first
   observation window. Disable it only after the Docker gateway has survived the
   agreed observation period.

## Rollback

Rollback does not require MySQL or Redis restoration for gateway-only Docker.

```bash
cd /root/opt/gugu
docker compose --env-file /etc/gugu-gateway/docker-compose.env \
  -f deploy/docker/compose.gateway-only.example.yaml down
systemctl start gugu-gateway
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
```

Then run the existing monitor and alert checks from the systemd deployment.

## What Not To Do In This Window

- Do not migrate MySQL into a container.
- Do not move Redis into a container.
- Do not change Nginx public HTTPS behavior.
- Do not introduce OSS payload storage.
- Do not disable the old systemd gateway until the Docker gateway has survived
  observation.

## Later Full-Stack Docker Or K8s

Full-stack Compose requires a separate data migration:

1. Fresh MySQL backup from host MySQL.
2. Restore into container MySQL volume.
3. Verify table counts, payment idempotency tables, and recent orders.
4. Point gateway env to `mysql:3306` and `redis:6379`.
5. Rehearse rollback from container MySQL back to host MySQL.

For K8s, reuse the same image, but translate runtime concerns separately:

- gateway -> `Deployment`
- env -> `ConfigMap` and `Secret`
- healthcheck -> readiness/liveness probes
- backup/alert jobs -> `CronJob`
- persistent MySQL -> managed database first, `StatefulSet` only after a
  deliberate storage decision
