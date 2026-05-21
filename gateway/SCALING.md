# Gugu Gateway Scaling And Resilience Plan

Last reviewed: 2026-05-20

This plan is based on the current single-server gateway deployment:

- Nginx listens on `80` and `443`.
- Bun gateway is managed by `gugu-gateway.service`.
- Bun gateway currently listens on `0.0.0.0:8787`.
- The app uses Bun plus SQLite with WAL enabled.
- The server currently has comfortable CPU, memory, and disk headroom.

The near-term risk is not raw CPU capacity. The bigger risks are direct exposure of the app port, free-credit abuse, upstream model cost spikes, long-running requests, weak observability, and stateful single-node recovery.

## Priority 0: Do First

These changes should happen before meaningful traffic growth.

### Bind Gateway To Localhost

The gateway should not be reachable directly from the public internet. Only nginx should proxy traffic to it.

- Set `GUGU_GATEWAY_HOST=127.0.0.1`.
- Keep `GUGU_GATEWAY_PORT=8787`.
- Restart `gugu-gateway.service`.
- Confirm `ss -lntp` shows `127.0.0.1:8787`, not `0.0.0.0:8787`.
- In the cloud security group, expose only required ports: usually `22`, `80`, and `443`.

### Add Nginx Rate Limits

Add basic limits at the nginx layer to absorb scanners, bursts, and simple abuse before traffic reaches Bun.

Recommended policies:

- `/v1/devices`: strict limit, because this grants free trial credit.
- `/v1/orders`: strict limit, because this can create spammy records.
- `/v1/attachments/parse`: strict limit and lower concurrency, because uploads are expensive.
- `/v1/messages`: moderate request limit plus connection/concurrency limit, because responses can be long-running.
- `/admin/*`: allow only trusted IPs or require strong auth.

Example shape:

```nginx
limit_req_zone $binary_remote_addr zone=gugu_ip:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=gugu_register:10m rate=3r/m;
limit_conn_zone $binary_remote_addr zone=gugu_conn:10m;

server {
  server_name gugu.guxingyao.com;

  client_max_body_size 50m;

  location = /v1/devices {
    limit_req zone=gugu_register burst=5 nodelay;
    proxy_pass http://127.0.0.1:8787;
  }

  location /v1/attachments/parse {
    limit_req zone=gugu_ip burst=10 nodelay;
    limit_conn gugu_conn 2;
    proxy_pass http://127.0.0.1:8787;
  }

  location / {
    limit_req zone=gugu_ip burst=60 nodelay;
    limit_conn gugu_conn 10;
    proxy_pass http://127.0.0.1:8787;
  }
}
```

Tune the numbers after observing real traffic. Start conservative while the service is still in trial mode.

### Protect Free Credits

`POST /v1/devices` currently creates a device and grants free trial credit. That is the most obvious cost-abuse path.

Recommended short-term defenses:

- Require an invite code for free trial activation.
- Or grant free credits only after a server-side allowlist check.
- Add per-IP and per-subnet registration limits.
- Add per-device and per-IP daily credit burn limits.
- Lower default free credits while payment is not fully normalized.
- Keep manual license issuing available for trusted users.

## Priority 1: Application Safeguards

These protect cost and stability after nginx has reduced obvious abuse.

### Add Device-Scoped Rate Limits

Nginx can limit by IP, but fair usage should be enforced by device token.

Recommended limits:

- Per-device concurrent `/v1/messages`: `1` to `2`.
- Per-device concurrent `/v1/attachments/parse`: `1`.
- Per-device requests per minute by endpoint.
- Per-device daily credit spend cap.
- Global gateway daily upstream spend cap.

Return `429` for rate-limit failures and include a clear retry message.

### Add Upstream Timeout And Circuit Breaker

Attachment forwarding already uses a timeout. Message forwarding should also have explicit protection.

Recommended behavior:

- Add `AbortSignal.timeout(...)` to DeepSeek message forwarding.
- Track upstream failure rate over a short rolling window.
- Temporarily return `503` when an upstream is clearly unhealthy.
- Refund credits only when the request was not successfully served.
- Log upstream status, timeout, and latency.

### Bound Request Body Size In App Code

Nginx has `client_max_body_size`, but app code should also reject oversized JSON or base64 payloads.

Recommended checks:

- Maximum JSON body size.
- Maximum `dataBase64` size.
- Operation-specific attachment limits.
- Clear `413 Payload Too Large` responses.

## Priority 2: Data Durability

SQLite is acceptable for the current stage, but it must be backed up and protected.

### Harden SQLite

Current WAL mode is good. Add:

- `PRAGMA busy_timeout = 5000`.
- Regular `VACUUM` or retention management if usage events grow quickly.
- Index review once `usage_events` becomes large.

### Backup The Database

Backups matter more than containerization for the current single-node setup.

Recommended minimum:

- Scheduled SQLite online backup to timestamped files.
- Copy backups off-machine to OSS/S3-compatible storage.
- Keep daily backups for at least 14 days.
- Test restore before relying on the backup.

Suggested backup targets:

- `/var/lib/gugu-gateway/backups`
- Object storage bucket with lifecycle retention

### Plan State Migration

When traffic or operations outgrow single-node SQLite:

- Move primary data to Postgres or MySQL.
- Move rate-limit counters to Redis.
- Keep API nodes stateless.
- Run multiple gateway replicas behind a load balancer.

## Priority 3: Observability

Add enough visibility to know whether growth is healthy or dangerous.

### Nginx Logs

Include latency and upstream timing:

```nginx
log_format gugu '$remote_addr $host "$request" $status '
                'rt=$request_time urt=$upstream_response_time '
                'ua="$http_user_agent"';
access_log /var/log/nginx/gugu_access.log gugu;
```

Track:

- Status code rate.
- `429`, `5xx`, and upstream timeouts.
- Top endpoints.
- Top client IPs.
- Request and upstream latency.

### Gateway Logs

Use structured logs for gateway requests:

- endpoint
- status
- latency
- upstream name
- upstream latency
- device id hash, not raw token
- credits consumed or refunded
- upstream status
- error code

Never log API keys, device tokens, license keys, or raw prompts.

### Alerts

Create alerts for:

- Gateway process restart loop.
- 5xx spike.
- 429 spike.
- Upstream timeout spike.
- Disk usage above `80%`.
- Memory pressure.
- Certificate expiration.
- Daily upstream spend above threshold.

## Priority 4: Systemd And Server Hardening

The service should not run as root long-term.

Recommended changes:

- Create a dedicated `gugu` Linux user.
- Store `.env` with `600` permissions.
- Remove stale swap files such as `.env.swp`.
- Avoid world-writable files and directories.
- Run gateway with least privilege.
- Add systemd hardening.

Example systemd hardening shape:

```ini
[Service]
User=gugu
Group=gugu
WorkingDirectory=/opt/gugu
EnvironmentFile=/opt/gugu/.env
ExecStart=/home/gugu/.bun/bin/bun run start
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/gugu-gateway
LimitNOFILE=262144
```

Validate carefully because `ProtectHome=true` can break paths under `/root` or `/home`. Move runtime data to `/var/lib/gugu-gateway`.

## Docker Recommendation

Docker is a good idea, but it should be introduced for the right reasons.

Docker helps with:

- Reproducible deployment.
- Cleaner rollback.
- Health checks.
- Isolated runtime dependencies.
- Easier move to multiple replicas later.
- Consistent local, staging, and production behavior.

Docker does not automatically solve:

- Traffic spikes.
- Cost abuse.
- SQLite write contention.
- Database backups.
- Multi-node high availability.
- CDN/static asset delivery.

### Recommended Docker Path

Use Docker in phases.

#### Phase 1: Single Container On Current VM

Goal: make deployment repeatable without changing architecture too much.

- Build a gateway image.
- Run it with Docker Compose.
- Keep nginx on the host, proxying to `127.0.0.1:8787`.
- Mount SQLite data as a host volume.
- Mount `.env` as a secret or env file.
- Add container health checks.
- Keep only localhost binding for the container port.

This phase improves operations but does not provide true horizontal scaling.

#### Phase 2: Compose With Nginx And Backup Job

Goal: make the single-machine stack more self-contained.

- `gateway` container.
- `nginx` container or host nginx, choose one and keep it simple.
- `backup` job container for SQLite backups.
- Shared Docker network.
- Persistent volume for SQLite.
- Log rotation.

If host nginx is already working, do not rush to containerize nginx unless it reduces operational complexity.

#### Phase 3: Stateless Gateway Replicas

Goal: real scale-out and fault tolerance.

Prerequisites:

- Move SQLite to Postgres or MySQL.
- Move rate limiting to Redis.
- Store downloads and release files in OSS/CDN.
- Make every gateway replica stateless.
- Put replicas behind a load balancer.
- Add rolling deploy and health checks.

At that point Docker, Docker Compose, or Kubernetes becomes a scaling tool rather than just packaging.

## Suggested Roadmap

### This Week

- Bind gateway to `127.0.0.1`.
- Close public access to `8787`.
- Add nginx rate limits.
- Add registration/free-credit abuse protection.
- Add DeepSeek request timeout.
- Add structured request logs.
- Add SQLite backup script.

### Next 2 Weeks

- Add app-level device token rate limits.
- Add upstream circuit breaker.
- Add admin/dashboard IP allowlist.
- Add systemd least-privilege user.
- Add Dockerfile and single-container Compose deployment.
- Add restore test for backups.

### Before Public Launch

- Move static downloads and update metadata to OSS/CDN.
- Formalize payment callback and signature verification.
- Move rate limits to Redis if multiple replicas are planned.
- Plan Postgres/MySQL migration if usage events or orders grow quickly.
- Add staging environment.
- Add synthetic health checks from outside the server.

## Current Recommendation

Do not make Docker the first response to traffic growth. First close the direct app port, add rate limits, and protect free credits.

After that, containerize the gateway as a deployment improvement. Treat Docker as preparation for the next architecture, not as the scaling architecture by itself.
