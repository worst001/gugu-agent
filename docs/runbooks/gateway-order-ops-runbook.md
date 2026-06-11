# Gateway Order Operations Runbook

Status: active for current production systemd deployment. Docker cutover is out of scope for this runbook.

Last updated: 2026-06-11 CST.

## Purpose

This runbook closes the current order/payment operational loop for Gugu Gateway. It covers order states, unpaid order cleanup, backlog alerts, payment/referral checks, and the remaining non-blocking order follow-ups.

## Current Production Facts

- Production gateway runs from `/root/opt/gugu` under `gugu-gateway.service`.
- Store driver is MySQL.
- Public health target is `https://gugu.guxingyao.com/health`.
- Payment QR TTL is 30 minutes for WeChat/Alipay order creation.
- Expired pending-payment orders are not deleted. They are marked `cancelled` for auditability.
- `gugu-gateway-pending-order-cleanup.timer` runs hourly.
- `gateway-alert-check` now evaluates order backlog from `/admin/api/metrics`.

## Order States

| State | Meaning | Normal Next Step | Operator Action |
| --- | --- | --- | --- |
| `pending_payment` | Order created, waiting for payment or manual fallback | payment notify, manual pay, or cleanup cancel | Watch backlog; do not fulfill without payment proof |
| `paid` | Payment marked but license not fulfilled yet | automatic/manual fulfill | Alert if it persists |
| `fulfilled` | License issued and order completed | none | Audit only |
| `cancelled` | Order cancelled by user/admin/cleanup | none | Audit only; do not reuse |

## Unpaid Order Cleanup

Cleanup policy:

- QR payment orders: cancel when `payment_expires_at` is older than `GUGU_PENDING_ORDER_CLEANUP_PAYMENT_GRACE_MS`.
- Default QR grace: `86400000` ms, or 24 hours after QR expiry.
- Manual fallback orders without `payment_expires_at`: cancel when created before `GUGU_PENDING_ORDER_CLEANUP_MANUAL_TTL_MS`.
- Default manual TTL: `604800000` ms, or 7 days.
- Cleanup updates `status='cancelled'`, `cancelled_at`, and `updated_at`; it does not delete rows.

Production deployment evidence on 2026-06-11:

- Pre-change orders: total `43`, `pending_payment=31`, `cancelled=8`, `fulfilled=4`.
- All 31 pending orders had expired `payment_expires_at`; no manual no-expiry pending orders were stale.
- Pre-mutation backup: `/var/backups/gugu-gateway/gateway-mysql-20260611-152513.sql`.
- Backup sha256: `1777a67b4036ef20c24dd0f367b630c38d72be8652061f35bd4c8c0cc7b04967`.
- Manual cleanup result: `cancelled=31`.
- Post-cleanup order counts: `cancelled=39`, `fulfilled=4`, no remaining `pending_payment` backlog.
- Timer installed and enabled: `gugu-gateway-pending-order-cleanup.timer`.
- Service dry-run after cleanup returned `paymentExpiredPending=0`, `manualStalePending=0`, `cancelled=0`.

## Commands

Dry-run cleanup:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/cleanup-pending-orders.ts \
  --env-file /root/opt/gugu/.env
```

Execute cleanup manually:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/cleanup-pending-orders.ts \
  --env-file /root/opt/gugu/.env \
  --execute
```

Check timer:

```bash
systemctl status gugu-gateway-pending-order-cleanup.timer --no-pager
systemctl list-timers --all gugu-gateway-pending-order-cleanup.timer --no-pager
journalctl -u gugu-gateway-pending-order-cleanup.service -n 80 --no-pager
```

Check order counts without printing customer/order secrets:

```sql
SELECT status, COUNT(*) AS count
FROM orders
GROUP BY status
ORDER BY status;

SELECT COUNT(*) AS expired_pending_over_24h
FROM orders
WHERE status = 'pending_payment'
  AND payment_expires_at IS NOT NULL
  AND payment_expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR);

SELECT COUNT(*) AS manual_pending_over_7d
FROM orders
WHERE status = 'pending_payment'
  AND payment_expires_at IS NULL
  AND created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY);
```

Run alert check safely during manual validation. If a webhook is configured, explicitly pass an empty webhook URL to avoid sending a test notification:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/gateway-alert-check.ts \
  --env-file /root/opt/gugu/.env \
  --backup-dir /var/backups/gugu-gateway \
  --webhook-url ""
```

## Admin Metrics

`GET /admin/api/metrics` includes an `orders` object with aggregate values only:

```json
{
  "orders": {
    "pendingPayment": 0,
    "paid": 0,
    "fulfilled": 4,
    "cancelled": 39,
    "paymentExpiredPending": 0,
    "manualStalePending": 0,
    "stalePending": 0
  }
}
```

Never add device IDs, full order IDs, contact details, license keys, referral codes, or payment payloads to metrics.

## Alert Thresholds

Configured through env or CLI:

- `GUGU_ALERT_MAX_PENDING_PAYMENT_ORDERS=100`
- `GUGU_ALERT_MAX_STALE_PENDING_ORDERS=0`

Alert codes:

- `PENDING_PAYMENT_ORDERS_HIGH`: total pending-payment backlog exceeded the configured threshold.
- `STALE_PENDING_ORDERS`: cleanup-eligible pending orders exist after the grace/TTL window.

Operational response:

1. Confirm `gugu-gateway-pending-order-cleanup.timer` is active.
2. Run cleanup dry-run and inspect `paymentExpiredPending` / `manualStalePending`.
3. If stale count is non-zero, run cleanup execute after confirming latest MySQL backup exists and sha matches.
4. If pending count is high but stale count is zero, this may be active checkout traffic; inspect order creation rate and payment provider status before cancelling anything.
5. If `paid` orders remain, check payment notification logs and fulfill path before touching data.

## Referral Order Observation

Referral is enabled in production, but as of the completed observation window there were still no real referral orders or rewards:

- `orders.referral_code IS NOT NULL`: 0
- `referral_rewards total/awarded/rejected`: 0/0/0

First real referral order validation checklist:

1. A referred order stores a non-empty `referral_code`.
2. Payment succeeds.
3. The referred device activates the first paid order.
4. Both devices receive +100 credits.
5. Exactly one `awarded` row is created.
6. Replays, repeated activation, repeated payment refresh, or the same referred device cannot award again.
7. The sixth monthly successful referral for one referrer records rejected due to monthly cap.

Do not print full referral code, invite URL, license key, token, full device id, or payment payload while observing.

## Rollback and Disable Options

Disable only the cleanup timer:

```bash
systemctl disable --now gugu-gateway-pending-order-cleanup.timer
```

Disable referral rewards without touching order creation:

```bash
cd /root/opt/gugu
cp -a .env .env.referral-disable-$(date +%Y%m%d%H%M%S).bak
sed -i 's/^GUGU_REFERRAL_ENABLED=.*/GUGU_REFERRAL_ENABLED=0/' .env || echo 'GUGU_REFERRAL_ENABLED=0' >> .env
systemctl restart gugu-gateway
curl -fsS http://127.0.0.1:18787/health
```

Do not drop referral tables during incident response. Do not delete cancelled orders as a quick fix.

## Remaining Order-Related Work

These are not blockers for order-chain closure:

1. Observe the first real referral order and reward.
2. Add a daily finance/order summary after off-host backup is connected.
3. Consider cancelled-order archival only after order volume reaches thousands or retention requirements are defined.
4. Optionally add dashboard UI badges for `pendingPayment` and `stalePending`; machine alerting already exists.
