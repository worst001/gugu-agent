# Gateway systemd, MySQL, and Redis Runbook

Last reviewed: 2026-05-28

This runbook is for the current single-server gateway deployment on AliyunOS or another CentOS/RHEL-like system. It prepares systemd, independent env files, MySQL 8.4 LTS, and Redis on the same host.

It covers the safe path from SQLite preparation through a MySQL cutover. The current safe order is:

1. Harden gateway service management and payment maintenance controls.
2. Install MySQL and Redis with conservative same-host resource limits.
3. Keep SQLite as the source of truth until import verification, contract tests, and rollback rehearsal pass.
4. Cut over to MySQL only after the rollback rehearsal passes.
5. Keep SQLite snapshots and cutover artifacts untouched during the first 24-72 hour post-cutover observation window.

Current production note: as of 2026-05-28 13:16 CST, production on
`139.196.214.54` has already been cut over from SQLite
`/var/lib/gugu-gateway/gateway.sqlite` to MySQL database `gugu_gateway`.
The live service still runs from `/root/opt/gugu` under
`gugu-gateway.service`; the `/opt/gugu-gateway` and `/etc/gugu-gateway`
layout below is the target normalized layout for a later cleanup window.

Reference source for MySQL installation: [MySQL 8.4 Yum Repository documentation](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-yum-repo.html).

## Runtime Map

- Gateway source directory: `/opt/gugu-gateway`
- Gateway runtime data: `/var/lib/gugu-gateway`
- SQLite source of truth today: `/var/lib/gugu-gateway/gateway.sqlite`
- Gateway env file: `/etc/gugu-gateway/gateway.env`
- MySQL setup env file: `/etc/gugu-gateway/mysql.env`
- Redis setup env file: `/etc/gugu-gateway/redis.env`
- Gateway systemd unit: `/etc/systemd/system/gugu-gateway.service`
- Gateway bind address: `127.0.0.1:18787`
- Public HTTPS entrypoint: nginx
- Legacy public `8787` compatibility: nginx proxy only, not the Bun process

## Guardrails

- Run payment-sensitive changes during the agreed night maintenance window.
- Put the gateway in maintenance mode before database migration or rollback work.
- Maintenance mode should block new orders but still let existing payment callbacks retry safely.
- Do not expose MySQL, Redis, or the Bun gateway port to the public internet.
- Do not put real API keys, payment keys, database passwords, or Redis passwords in the repo.
- Do not change the official website content during this migration work.

## Preflight

Run these on the server before changing anything:

```bash
cat /etc/os-release
id gugu
free -h
df -h
ss -lntp
systemctl status gugu-gateway --no-pager
curl -fsS http://127.0.0.1:18787/health
```

Expected result:

- OS is AliyunOS or another EL-compatible system.
- `gugu` exists or will be created in the next step.
- Disk and memory have comfortable headroom.
- Gateway health check returns successfully before changes.

## Prepare Users And Directories

```bash
sudo useradd --system --home /opt/gugu-gateway --shell /sbin/nologin gugu
sudo install -d -o gugu -g gugu -m 0750 /opt/gugu-gateway
sudo install -d -o gugu -g gugu -m 0750 /var/lib/gugu-gateway
sudo install -d -o gugu -g gugu -m 0750 /var/backups/gugu-gateway
sudo install -d -o root -g gugu -m 0750 /etc/gugu-gateway
sudo install -d -o root -g gugu -m 0750 /etc/gugu-gateway/secrets
```

If `useradd` says the user already exists, continue after confirming `id gugu`.

## Deploy Gateway Env And systemd

Run from the repository root:

```bash
sudo install -o root -g gugu -m 0600 gateway/deploy/env/gateway.env.example /etc/gugu-gateway/gateway.env
sudo install -o root -g root -m 0644 gateway/deploy/systemd/gugu-gateway.service /etc/systemd/system/gugu-gateway.service
sudo rsync -a gateway/ /opt/gugu-gateway/
sudo chown -R gugu:gugu /opt/gugu-gateway
```

Edit the env file and replace placeholders:

```bash
sudoedit /etc/gugu-gateway/gateway.env
```

Minimum production checks inside `gateway.env`:

- `GUGU_GATEWAY_HOST=127.0.0.1`
- `GUGU_GATEWAY_PORT=18787`
- `GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite`
- `GUGU_STORE_DRIVER=sqlite`
- `GUGU_MYSQL_URL` can be filled for dry-run tooling and contract tests, but production should keep `GUGU_STORE_DRIVER=sqlite` until the import verification and rollback rehearsal pass.
- `GUGU_PUBLIC_BASE_URL` is the public HTTPS origin.
- Payment keys and cert paths point to files under `/etc/gugu-gateway/secrets`.
- `GUGU_MAINTENANCE_MODE=0` outside maintenance windows.
- `GUGU_MAINTENANCE_DISABLE_ORDERS=0` outside maintenance windows.

Install dependencies as the service user:

```bash
cd /opt/gugu-gateway
sudo -u gugu env PATH=/home/gugu/.bun/bin:/usr/local/bin:/usr/bin bun install --production
```

If `bun` is not found, install Bun for `gugu` first or update the `PATH` line in `gateway/deploy/systemd/gugu-gateway.service` to the real Bun path. The template checks `/opt/gugu-gateway/.bun/bin`, `/home/gugu/.bun/bin`, and common system paths.

## Backup SQLite Before Restarting

```bash
cd /opt/gugu-gateway
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway GUGU_GATEWAY_BACKUP_RETENTION_DAYS=7 bun run scripts/backup.ts
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway bun run scripts/restore-check.ts
```

The backup script uses SQLite `VACUUM INTO`, so it creates a consistent compact snapshot without stopping the gateway. The restore-check script copies the newest backup to a temporary path, runs `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and verifies the key business tables exist.

Useful overrides:

```bash
GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway
GUGU_GATEWAY_BACKUP_RETENTION_DAYS=7
bun run scripts/backup.ts --db /var/lib/gugu-gateway/gateway.sqlite --out-dir /var/backups/gugu-gateway
bun run scripts/restore-check.ts --backup /var/backups/gugu-gateway/gateway-YYYYMMDD-HHMMSS.sqlite
```

To run this automatically every night, install the timer templates:

```bash
sudo cp gateway/deploy/systemd/gugu-gateway-backup.service /etc/systemd/system/
sudo cp gateway/deploy/systemd/gugu-gateway-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gugu-gateway-backup.timer
systemctl list-timers gugu-gateway-backup.timer --no-pager
```

Use `docs/runbooks/gateway-backup-timer-checklist.md` for the production acceptance checklist, including manual first run, restore verification, retention review, and rollback.

## Start Or Restart Gateway

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gugu-gateway
sudo systemctl status gugu-gateway --no-pager
journalctl -u gugu-gateway -n 100 --no-pager
curl -fsS http://127.0.0.1:18787/health
ss -lntp | grep 18787
```

Expected result:

- `gugu-gateway.service` is active.
- Health check succeeds.
- Bun listens on `127.0.0.1:18787`, not `0.0.0.0`.
- Nginx is the only public entrypoint.

## Maintenance Mode

Use this before database migration windows or payment-risk operations.

There are two levels:

- Order maintenance: blocks new orders and marks buy/checkout pages.
- Write freeze: blocks public database writes for database cutover or rollback
  rehearsal. This includes device registration, activation, messages,
  attachment parsing, order creation, and payment notifications. Payment
  providers receive a non-success response and should retry after the window.

Turn maintenance on:

```bash
sudo cp -a /etc/gugu-gateway/gateway.env /etc/gugu-gateway/gateway.env.$(date +%Y%m%d%H%M%S).bak
sudo sed -i 's/^GUGU_MAINTENANCE_MODE=.*/GUGU_MAINTENANCE_MODE=1/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_ORDERS=.*/GUGU_MAINTENANCE_DISABLE_ORDERS=1/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_WRITES=.*/GUGU_MAINTENANCE_DISABLE_WRITES=0/' /etc/gugu-gateway/gateway.env
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

For a database cutover or rollback rehearsal, turn on the full write freeze
instead:

```bash
sudo cp -a /etc/gugu-gateway/gateway.env /etc/gugu-gateway/gateway.env.$(date +%Y%m%d%H%M%S).bak
sudo sed -i 's/^GUGU_MAINTENANCE_MODE=.*/GUGU_MAINTENANCE_MODE=1/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_ORDERS=.*/GUGU_MAINTENANCE_DISABLE_ORDERS=1/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_WRITES=.*/GUGU_MAINTENANCE_DISABLE_WRITES=1/' /etc/gugu-gateway/gateway.env
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

Verify behavior:

```bash
curl -i http://127.0.0.1:18787/buy
curl -i http://127.0.0.1:18787/checkout
curl -i -X POST http://127.0.0.1:18787/v1/orders -H 'Content-Type: application/json' -d '{}'
curl -i -X POST http://127.0.0.1:18787/v1/devices -H 'Content-Type: application/json' -d '{"deviceId":"maintenance-check"}'
curl -i -X POST http://127.0.0.1:18787/v1/messages -H 'Content-Type: application/json' -H 'x-gugu-device-token: maintenance-check' -d '{"messages":[]}'
```

Expected result:

- Buy and checkout pages show the maintenance message.
- `POST /v1/orders` returns `503 MAINTENANCE`.
- If `GUGU_MAINTENANCE_DISABLE_WRITES=1`, public write endpoints such as
  `/v1/devices`, `/v1/activate`, `/v1/messages`, `/v1/attachments/parse`,
  `/v1/payments/wechat/notify`, and `/v1/payments/alipay/notify` return
  `503 MAINTENANCE` before mutating storage.

Turn maintenance off:

```bash
sudo sed -i 's/^GUGU_MAINTENANCE_MODE=.*/GUGU_MAINTENANCE_MODE=0/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_ORDERS=.*/GUGU_MAINTENANCE_DISABLE_ORDERS=0/' /etc/gugu-gateway/gateway.env
sudo sed -i 's/^GUGU_MAINTENANCE_DISABLE_WRITES=.*/GUGU_MAINTENANCE_DISABLE_WRITES=0/' /etc/gugu-gateway/gateway.env
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

## Install MySQL 8.4 LTS

Use the official MySQL Yum repository. The repository RPM filename changes over time, so choose the correct package for the server platform from the official MySQL Yum Repository page before running this step.

```bash
cat /etc/os-release
```

Download the matching `mysql84-community-release-{platform}-{version-number}.noarch.rpm` for the server, then:

```bash
MYSQL84_REPO_RPM=/path/to/mysql84-community-release-el8-REPLACE.noarch.rpm
sudo dnf localinstall -y "$MYSQL84_REPO_RPM"
sudo dnf module disable -y mysql || true
sudo dnf repolist enabled | grep mysql
```

Expected result:

- `mysql-8.4-lts-community` is enabled.
- Innovation-series repositories are not enabled for server installation.

Install and configure MySQL:

```bash
sudo dnf install -y mysql-community-server
sudo install -o root -g root -m 0644 gateway/deploy/mysql/gugu-gateway.cnf /etc/my.cnf.d/gugu-gateway.cnf
sudo systemctl enable --now mysqld
sudo systemctl status mysqld --no-pager
sudo grep 'temporary password' /var/log/mysqld.log
```

Set the root password interactively:

```bash
mysql -uroot -p
```

Then create the app database and user. Replace the password with the value that will go into `/etc/gugu-gateway/mysql.env`.

```sql
CREATE DATABASE IF NOT EXISTS gugu_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'gugu_gateway_app'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
CREATE USER IF NOT EXISTS 'gugu_gateway_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON gugu_gateway.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON gugu_gateway.* TO 'gugu_gateway_app'@'localhost';
FLUSH PRIVILEGES;
```

Create the setup env file:

```bash
sudo install -o root -g gugu -m 0600 gateway/deploy/env/mysql.env.example /etc/gugu-gateway/mysql.env
sudoedit /etc/gugu-gateway/mysql.env
```

Verify:

```bash
mysqladmin -h127.0.0.1 -ugugu_gateway_app -p ping
mysql -h127.0.0.1 -ugugu_gateway_app -p -e 'SELECT 1' gugu_gateway
ss -lntp | grep 3306
```

Expected result:

- MySQL listens on `127.0.0.1:3306`.
- App user can connect only with the configured password.
- No gateway code points at MySQL yet.

After applying `deploy/mysql/schema.sql`, verify the configured database shape from the gateway code:

```bash
cd /opt/gugu-gateway
sudo -u gugu env GUGU_MYSQL_URL='mysql://gugu_gateway_app:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:3306/gugu_gateway' bun run mysql-schema-check
```

Expected result:

- `ok` is `true`.
- `missingTables` is empty.
- `missingIndexes` is empty.

## Prepare MySQL Schema And Migration Report

The initial MySQL schema draft lives at `gateway/deploy/mysql/schema.sql`. Applying it only creates empty MySQL tables; it does not move production traffic or change the SQLite source of truth.

```bash
cd /opt/gugu-gateway
mysql -h127.0.0.1 -ugugu_gateway_app -p gugu_gateway < deploy/mysql/schema.sql
mysql -h127.0.0.1 -ugugu_gateway_app -p -e 'SHOW TABLES' gugu_gateway
```

Before any SQLite export or MySQL import, generate a read-only migration report from the current SQLite database:

```bash
cd /opt/gugu-gateway
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite bun run migration-report
```

For a maintenance-window gate, make the report fail the command if migration-blocking errors exist:

```bash
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite bun run scripts/migration-report.ts --fail-on-issues
```

Expected result:

- `ok` is `true`.
- `sqlite.integrity` is `ok`.
- `issueSummary.errors` is `0`.
- Row counts are present for `devices`, `activation_codes`, `usage_events`, `orders`, and `payment_notifications`.
- Payment uniqueness checks report no duplicate WeChat transaction IDs, Alipay trade numbers, or notification IDs.

Generate a data-only MySQL import file from SQLite for a scratch-database dry run:

```bash
cd /opt/gugu-gateway
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite bun run scripts/export-mysql.ts --out /var/backups/gugu-gateway/gateway-mysql-import-YYYYMMDD-HHMMSS.sql
```

The export script writes a sibling `.manifest.json` file with table counts and business totals. Import only into an empty dry-run MySQL database:

```bash
mysql -h127.0.0.1 -ugugu_gateway_app -p gugu_gateway_dryrun < deploy/mysql/schema.sql
mysql -h127.0.0.1 -ugugu_gateway_app -p gugu_gateway_dryrun < /var/backups/gugu-gateway/gateway-mysql-import-YYYYMMDD-HHMMSS.sql
```

After import, generate and run the manifest comparison SQL:

```bash
sudo -u gugu bun run scripts/mysql-verify-sql.ts \
  --manifest /var/backups/gugu-gateway/gateway-mysql-import-YYYYMMDD-HHMMSS.sql.manifest.json \
  --out /var/backups/gugu-gateway/gateway-mysql-verify-YYYYMMDD-HHMMSS.sql

mysql -h127.0.0.1 -ugugu_gateway_app -p gugu_gateway_dryrun < /var/backups/gugu-gateway/gateway-mysql-verify-YYYYMMDD-HHMMSS.sql
```

Expected result:

- Every detailed check has `result = ok`.
- The final summary row has `verification_status = ok`.
- `mismatches = 0`.

Do not point gateway traffic at this database until the import comparison, storage contract tests, and rollback rehearsal all pass.

## MySQL Cutover And Rollback Rehearsal

Use this only during the agreed low-traffic maintenance window. The rehearsal
keeps public writes frozen, imports a fresh SQLite snapshot into a MySQL
rehearsal database, briefly points the gateway at that MySQL database, verifies
health, and then restores the original gateway env so production returns to
SQLite.

Preview the exact plan first:

```bash
cd /root/opt/gugu
bun run mysql-cutover-rehearsal --plan-only \
  --env-file /root/opt/gugu/.env \
  --mysql-env-file /etc/gugu-gateway/mysql.env \
  --db /var/lib/gugu-gateway/gateway.sqlite \
  --backup-dir /var/backups/gugu-gateway \
  --rehearsal-db gugu_gateway_dryrun
```

`--rehearsal-db` must already exist and the app user from
`/etc/gugu-gateway/mysql.env` must have privileges on it. The production host
currently has `gugu_gateway_dryrun` for this purpose.

Run the rehearsal:

```bash
cd /root/opt/gugu
bun run mysql-cutover-rehearsal \
  --env-file /root/opt/gugu/.env \
  --mysql-env-file /etc/gugu-gateway/mysql.env \
  --db /var/lib/gugu-gateway/gateway.sqlite \
  --backup-dir /var/backups/gugu-gateway \
  --rehearsal-db gugu_gateway_dryrun \
  --confirm I_UNDERSTAND_THIS_FREEZES_WRITES
```

After the rehearsal passes, run the real cutover by targeting the production
database and adding `--commit-mysql`:

```bash
cd /root/opt/gugu
bun run mysql-cutover-rehearsal \
  --commit-mysql \
  --env-file /root/opt/gugu/.env \
  --mysql-env-file /etc/gugu-gateway/mysql.env \
  --db /var/lib/gugu-gateway/gateway.sqlite \
  --backup-dir /var/backups/gugu-gateway \
  --rehearsal-db gugu_gateway \
  --confirm I_UNDERSTAND_THIS_SWITCHES_PRODUCTION_TO_MYSQL
```

This mode still freezes writes before exporting from SQLite. On success it
keeps `GUGU_STORE_DRIVER=mysql`, keeps `GUGU_MYSQL_URL` in the gateway env, and
turns maintenance and write freeze back off. On failure before commit, it
restores the original env and returns to SQLite.

The script refuses daytime execution unless `--allow-daytime` is passed. It also
backs up the gateway env inside the run artifact directory and restores that env
after the MySQL smoke, including on failure.

Expected result:

- `GUGU_MAINTENANCE_MODE=1`, `GUGU_MAINTENANCE_DISABLE_ORDERS=1`, and
  `GUGU_MAINTENANCE_DISABLE_WRITES=1` are enabled before export/import work.
- `POST /v1/devices` returns `503` while writes are frozen.
- SQLite backup, restore-check, migration report, MySQL import verification,
  and MySQL schema check all pass.
- Gateway health passes while temporarily using `GUGU_STORE_DRIVER=mysql`.
- The original env is restored and gateway health passes again on SQLite.

For `--commit-mysql`, the final expected env differs: the gateway should keep
`GUGU_STORE_DRIVER=mysql`, keep `GUGU_MYSQL_URL` set, and have maintenance plus
write freeze disabled.

## Post-Cutover Payment Monitor

After a MySQL cutover, run the read-only monitor from the live gateway tree:

```bash
cd /root/opt/gugu
bun run scripts/post-cutover-monitor.ts \
  --env-file /root/opt/gugu/.env \
  --hours 24 \
  --recent 12
```

Expected result:

- `ok` is `true`.
- Local health returns status `200`.
- Fulfilled orders have licenses.
- Paid amounts match order amounts.
- Payment notifications are `processed`.
- `issues` is empty.

The first production run after the 2026-05-28 cutover returned `ok=true` and
`issues=[]` with one fulfilled WeChat order and one fulfilled Alipay order in
the 24-hour window.

## MySQL Backups After Cutover

After production switches to `GUGU_STORE_DRIVER=mysql`, the SQLite backup timer
is no longer sufficient for active business data. Keep SQLite rollback snapshots
untouched during the first 24-72 hours, but add a MySQL dump backup for the live
store.

Manual backup from the live gateway tree:

```bash
cd /root/opt/gugu
bun run scripts/mysql-backup.ts \
  --env-file /root/opt/gugu/.env \
  --out-dir /var/backups/gugu-gateway \
  --retention-days 7
```

Expected result:

- A `gateway-mysql-YYYYMMDD-HHMMSS.sql` dump is created.
- A sibling `.manifest.json` file records table counts and SHA-256.
- A sibling `.sha256` file is created.
- The script exits non-zero if `GUGU_MYSQL_URL` is missing, MySQL is
  unreachable, both dump methods fail, or the dump is empty.

By default, `mysql-backup.ts` uses `--dump-method auto`: it tries `mysqldump`
first and falls back to a mysql2-based logical SQL dump if the local MySQL
client cannot authenticate with the same URL. Use `--dump-method mysqldump` or
`--dump-method js` to force either path.

For the normalized `/opt/gugu-gateway` layout, install the timer templates:

```bash
sudo cp gateway/deploy/systemd/gugu-gateway-mysql-backup.service /etc/systemd/system/
sudo cp gateway/deploy/systemd/gugu-gateway-mysql-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gugu-gateway-mysql-backup.timer
systemctl list-timers gugu-gateway-mysql-backup.timer --no-pager
```

Before relying on the timer, run the service once manually and review the
manifest:

```bash
sudo systemctl start gugu-gateway-mysql-backup.service
journalctl -u gugu-gateway-mysql-backup.service -n 100 --no-pager
ls -lh /var/backups/gugu-gateway/gateway-mysql-*.sql
```

Current production note: because the live gateway still uses `/root/opt/gugu`
until the later layout normalization window, production has an adapted
`gugu-gateway-mysql-backup.service` installed directly under
`/etc/systemd/system`. It was manually started successfully on 2026-05-28 and
`gugu-gateway-mysql-backup.timer` is enabled, with the next run scheduled for
2026-05-29 03:38:38 CST.

Optional local Docker rehearsal for a non-production SQLite copy:

```bash
docker pull mysql:8.4
docker run --rm --name gugu-mysql-dryrun \
  -e MYSQL_ROOT_PASSWORD=gugu-dryrun-root \
  -e MYSQL_DATABASE=gugu_gateway_dryrun \
  -d mysql:8.4 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_0900_ai_ci \
  --skip-name-resolve=ON

docker exec gugu-mysql-dryrun mysqladmin ping -uroot -pgugu-dryrun-root --silent
docker cp deploy/mysql/schema.sql gugu-mysql-dryrun:/tmp/schema.sql
docker cp /path/to/gateway-mysql-import.sql gugu-mysql-dryrun:/tmp/gateway-mysql-import.sql
docker cp /path/to/gateway-mysql-verify.sql gugu-mysql-dryrun:/tmp/gateway-mysql-verify.sql
docker exec gugu-mysql-dryrun sh -lc 'mysql -uroot -pgugu-dryrun-root gugu_gateway_dryrun < /tmp/schema.sql'
docker exec gugu-mysql-dryrun sh -lc 'mysql -uroot -pgugu-dryrun-root gugu_gateway_dryrun < /tmp/gateway-mysql-import.sql'
docker exec gugu-mysql-dryrun sh -lc 'mysql -uroot -pgugu-dryrun-root --table gugu_gateway_dryrun < /tmp/gateway-mysql-verify.sql'
docker stop gugu-mysql-dryrun
```

## Install Redis

Install Redis from the system package source that matches the server. The service name can be `redis` or `redis-server` depending on the distribution.

```bash
sudo dnf install -y redis
systemctl list-unit-files | grep redis
rpm -ql redis | grep '/redis.conf$'
```

Merge the values from `gateway/deploy/redis/gugu-gateway-redis.conf` into the real Redis config file. Replace and uncomment `requirepass` on the server.

```bash
sudoedit /etc/redis.conf
sudo systemctl enable --now redis
sudo systemctl status redis --no-pager
```

Create the setup env file:

```bash
sudo install -o root -g gugu -m 0600 gateway/deploy/env/redis.env.example /etc/gugu-gateway/redis.env
sudoedit /etc/gugu-gateway/redis.env
```

Verify:

```bash
redis-cli -a 'REPLACE_WITH_STRONG_PASSWORD' PING
ss -lntp | grep 6379
```

Expected result:

- Redis listens on `127.0.0.1:6379`.
- `PING` returns `PONG`.
- `maxmemory` is `256mb`.
- `maxmemory-policy` is `noeviction`.
- Gateway code can use Redis for limiter/circuit state, but both switches
  default to off.

## Enable Redis Limiter And Circuit State

Use this only after Redis is installed, localhost-only, password/env wiring is
verified, and MySQL cutover monitoring is clean.

Add the Redis URL and keep both feature flags off for the first restart:

```bash
sudo cp -a /etc/gugu-gateway/gateway.env /etc/gugu-gateway/gateway.env.$(date +%Y%m%d%H%M%S).bak
sudoedit /etc/gugu-gateway/gateway.env
```

Required values:

```bash
GUGU_REDIS_URL=redis://:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:6379/0
GUGU_REDIS_COMMAND_TIMEOUT_MS=1000
GUGU_REDIS_LIMITER_ENABLED=0
GUGU_REDIS_CIRCUIT_ENABLED=0
```

Restart and verify the gateway still uses the existing in-memory behavior:

```bash
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
journalctl -u gugu-gateway -n 100 --no-pager
```

Then enable limiter first:

```bash
sudo sed -i 's/^GUGU_REDIS_LIMITER_ENABLED=.*/GUGU_REDIS_LIMITER_ENABLED=1/' /etc/gugu-gateway/gateway.env
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

If logs stay clean, enable shared circuit state:

```bash
sudo sed -i 's/^GUGU_REDIS_CIRCUIT_ENABLED=.*/GUGU_REDIS_CIRCUIT_ENABLED=1/' /etc/gugu-gateway/gateway.env
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

Expected behavior:

- Redis failures log a warning and fall back to in-memory limiter/circuit.
- Admin metrics include circuit `backend` and `fallbackActive` fields.
- Payment and order endpoints remain backed by MySQL, not Redis.

Current production note: Redis limiter and circuit state were enabled on
2026-05-28. Admin metrics showed DeepSeek and GLM circuits with
`backend=redis` and `fallbackActive=false`, and the post-change monitor returned
`ok=true` with `issues=[]`.

## Post-Change Health Checks

```bash
systemctl status gugu-gateway --no-pager
systemctl status mysqld --no-pager
systemctl status redis --no-pager
curl -fsS http://127.0.0.1:18787/health
free -h
df -h /var/lib/gugu-gateway
journalctl -u gugu-gateway -n 100 --no-pager
```

Check externally through nginx:

```bash
curl -fsS https://gugu.example.com/health
```

Replace `https://gugu.example.com` with the real gateway domain.

## Rollback

Gateway env or systemd rollback:

```bash
sudo ls -lh /etc/gugu-gateway/gateway.env.*.bak
sudo cp -a /etc/gugu-gateway/gateway.env.YYYYMMDDHHMMSS.bak /etc/gugu-gateway/gateway.env
sudo systemctl daemon-reload
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

MySQL or Redis install issue:

```bash
sudo systemctl disable --now mysqld
sudo systemctl disable --now redis
sudo systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

SQLite remains the gateway source of truth during this runbook, so disabling MySQL or Redis should not affect normal gateway behavior before migration code is enabled.

## Backup Retention

Keep at least seven days of SQLite backups after any migration-related change. During the first 72 hours after a data switch, keep rollback backups untouched.

Review old backups before pruning:

```bash
find /var/backups/gugu-gateway -type f -name 'gateway-*.sqlite' -mtime +7 -print
```

## Migration Readiness Checklist

Do not switch `GUGU_STORE_DRIVER=mysql` until all items are true:

- Gateway storage has a tested interface and separate SQLite/MySQL implementations.
- SQLite contract tests and the MySQL storage contract pass against the target schema.
- Full SQLite export to MySQL has row-count and business-total verification.
- Shadow writes have run for at least 3-7 days without mismatch.
- Payment notify idempotency and transaction unique constraints are present in MySQL.
- Maintenance mode has been tested for `/buy`, `/checkout`, `/v1/orders`, and
  full public write freeze through `GUGU_MAINTENANCE_DISABLE_WRITES=1`.
- Rollback from MySQL to SQLite has been rehearsed with a recent backup.
