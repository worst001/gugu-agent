# Gateway Launch Offer And Referral Rollout

Status: production code deploy, MySQL migration 002, and referral feature flag
enablement executed on 2026-06-06.

Docker cutover is explicitly out of scope. Keep production on the current
`/root/opt/gugu` + systemd layout.

2026-06-06 18:22-18:32 CST update: production code deploy and MySQL migration
002 were executed with Docker still untouched. Launch offer packages are visible
on `/buy`.

2026-06-06 18:37-18:43 CST update: `GUGU_REFERRAL_ENABLED=1` was enabled after
the packaged client was reported ready. Sanitized smoke passed for a free device
and an existing paid device.

## Scope

This rollout covers two product changes:

- launch offer packages on the public buy page:
  - `launch-pro-monthly`: 29 CNY, 600 credits
  - `launch-max-monthly`: 69 CNY, 1500 credits
- referral rewards, shipped behind `GUGU_REFERRAL_ENABLED=0` first:
  - paid devices can fetch `GET /v1/referrals/me`,
  - orders may carry `referralCode`,
  - activation of a referred first paid order can award both devices 100 credits,
  - monthly referrer cap defaults to 500 credits.

Desktop/client support is small and separate: the subscription settings page
calls local `/api/billing/referral` and shows "复制邀请链接" only when the gateway
returns `enabled=true`.

## Local Verification Already Run

Gateway:

```bash
cd gateway
bun test
git diff --check
```

Desktop/client:

```bash
cd desktop
bun run test src/__tests__/generalSettings.test.tsx
bun run lint
```

Server billing proxy:

```bash
bun test src/server/__tests__/billing.test.ts
```

## Production Order

### 1. Preflight

Run only read-only checks first:

```bash
ssh root@139.196.214.54 systemctl is-active gugu-gateway
ssh root@139.196.214.54 systemctl is-active mysqld
ssh root@139.196.214.54 systemctl is-active redis
ssh root@139.196.214.54 curl -fsS http://127.0.0.1:18787/health
```

Also confirm the newest local MySQL backup has SQL, manifest, and sha256 files:

```bash
ssh root@139.196.214.54 ls -1t /var/backups/gugu-gateway/gateway-mysql-*.sql
```

### 2. Deploy Code With Referral Disabled

Keep the existing archive deployment pattern. Do not overwrite `.env`,
certificates, `node_modules`, or runtime data.

Before restart, ensure production env either omits the flag or sets it off:

```bash
GUGU_REFERRAL_ENABLED=0
GUGU_REFERRAL_REWARD_CREDITS=100
GUGU_REFERRAL_MONTHLY_CAP=500
```

Expected behavior after this deploy:

- `/buy` shows the launch offer packages.
- `POST /v1/orders` still works for launch package IDs.
- `GET /v1/referrals/me` returns `enabled=false`.
- No referral reward is awarded because the flag is off.

Production result on 2026-06-06:

- deployed gateway `c20c6a3 feat: add launch referrals`;
- rollback directories:
  - `/root/opt/gugu-prev-launch-referral-20260606182730`
  - `/root/opt/gugu-backups/gugu-before-launch-referral-20260606182730`
- local/public health OK after restart;
- `GUGU_REFERRAL_ENABLED=0` confirmed.

### 3. Apply MySQL Migration 002

Take a fresh backup immediately before the migration:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-backup.ts \
  --env-file /root/opt/gugu/.env \
  --backup-dir /var/backups/gugu-gateway
```

Apply:

```bash
cd /root/opt/gugu
mysql -h127.0.0.1 -ugugu_gateway_app -p gugu_gateway < deploy/mysql/002-referrals.sql
```

Verify tables and migration row:

```sql
SHOW COLUMNS FROM orders LIKE 'referral_code';
SHOW TABLES LIKE 'referral_codes';
SHOW TABLES LIKE 'referral_rewards';
SELECT * FROM gateway_schema_migrations WHERE version = '002';
```

Do not enable `GUGU_REFERRAL_ENABLED=1` unless these checks pass.

Production result on 2026-06-06: migration 002 applied successfully; guarded
check returned `ordersReferralCode=1`, `referralCodes=1`, `referralRewards=1`,
`schemaMigration=1`.

### 4. Smoke With Flag Still Off

After restart:

```bash
curl -fsS http://127.0.0.1:18787/health
curl -fsS https://gugu.guxingyao.com/health
/root/.bun/bin/bun run /root/opt/gugu/scripts/gateway-alert-check.ts \
  --env-file /root/opt/gugu/.env
```

Manual browser check:

- `/buy` displays `Pro 首月 29` and `Max 首月 69`.
- The page says "首月低至 6 折"; do not claim Max is exactly 6折.

Production result on 2026-06-06:

- `/buy` includes `launch-pro-monthly`, `launch-max-monthly`, and
  "首月低至 6 折";
- `/checkout?packageId=launch-pro-monthly` shows Pro launch month and 600
  credits;
- `mysql-schema-check` returned `ok=true`;
- post-migration backup
  `/var/backups/gugu-gateway/gateway-mysql-20260606-183102.sql` was created and
  sha verified;
- `gateway-alert-check` returned `ok=true`, `issues=[]`;
- `gugu-gateway-monitor.service` returned `issues=[]`.

### 5. Enable Referral In A Small Window

Only after the packaged client has been tested and migration 002 is verified:

```bash
cd /root/opt/gugu
cp -a .env .env.referral-enable-$(date +%Y%m%d%H%M%S).bak
# edit or append:
# GUGU_REFERRAL_ENABLED=1
# GUGU_REFERRAL_REWARD_CREDITS=100
# GUGU_REFERRAL_MONTHLY_CAP=500
systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

Smoke:

- paid device `GET /v1/referrals/me` returns `enabled=true`, `eligible=true`,
  non-null `code`, and `/buy?ref=...`.
- free/trial device returns `enabled=true`, `eligible=false`.
- a referred first paid order stores `orders.referral_code`.
- activation awards both devices 100 credits once.
- repeated activation/payment polling does not award twice.

Production result on 2026-06-06:

- env backup before enable:
  `/root/opt/gugu/.env.referral-enable-20260606183756.bak`;
- current flags:
  - `GUGU_REFERRAL_ENABLED=1`
  - `GUGU_REFERRAL_REWARD_CREDITS=100`
  - `GUGU_REFERRAL_MONTHLY_CAP=500`
- free ops smoke device returned `enabled=true`, `eligible=false`, no code/url;
- existing paid device returned `enabled=true`, `eligible=true`, has code and
  invite URL; token/code/url were not printed;
- `referral_codes=1`, `referral_rewards=0`;
- post-enable backup:
  `/var/backups/gugu-gateway/gateway-mysql-20260606-184213.sql`, sha OK;
- health, alert, and monitor all OK with `issues=[]`.

Real-order observation baseline on 2026-06-06:

- `orders_with_referral_code=0`
- `referral_rewards_total=0`
- `referral_rewards_awarded=0`
- `referral_rewards_rejected=0`
- `referral_codes_total=1`

An in-thread heartbeat named "观察推荐真实订单" now checks production every 2
hours for roughly 24 hours using read-only SSH checks. It should only report
changes or anomalies and must not print tokens, license keys, full referral
codes, invite URLs, or full device ids.

## Rollback

Fast referral rollback:

```bash
cd /root/opt/gugu
cp -a .env .env.referral-disable-$(date +%Y%m%d%H%M%S).bak
# set GUGU_REFERRAL_ENABLED=0
systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

This disables new referral links and rewards. It does not hide the launch offer
packages; hiding launch packages requires deploying a package-list rollback.

Do not drop referral tables during an incident. They are additive and should be
left in place unless a human owner explicitly approves a data rollback plan.
