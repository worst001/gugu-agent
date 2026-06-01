-- Gugu Gateway MySQL dry-run verification SQL.
-- Manifest: D:\Claude Code\claude-code-gugu\.tmp\gateway-docker-dryrun-0527a\gateway-mysql-import.manifest.json
-- Export generated at: 2026-05-27T10:39:31.313Z
-- Import SQL: D:\Claude Code\claude-code-gugu\.tmp\gateway-docker-dryrun-0527a\gateway-mysql-import.sql

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

WITH checks AS (
  SELECT
    'table.devices.rows' AS check_name,
    1 AS expected,
    (SELECT COUNT(*) FROM `devices`) AS actual
  UNION ALL
  SELECT
    'table.activation_codes.rows' AS check_name,
    3 AS expected,
    (SELECT COUNT(*) FROM `activation_codes`) AS actual
  UNION ALL
  SELECT
    'table.usage_events.rows' AS check_name,
    1 AS expected,
    (SELECT COUNT(*) FROM `usage_events`) AS actual
  UNION ALL
  SELECT
    'table.orders.rows' AS check_name,
    3 AS expected,
    (SELECT COUNT(*) FROM `orders`) AS actual
  UNION ALL
  SELECT
    'table.payment_notifications.rows' AS check_name,
    2 AS expected,
    (SELECT COUNT(*) FROM `payment_notifications`) AS actual
  UNION ALL
  SELECT
    'total.devices.credits_total' AS check_name,
    12 AS expected,
    (SELECT COALESCE(SUM(credits_total), 0) FROM devices) AS actual
  UNION ALL
  SELECT
    'total.devices.credits_remaining' AS check_name,
    9 AS expected,
    (SELECT COALESCE(SUM(credits_remaining), 0) FROM devices) AS actual
  UNION ALL
  SELECT
    'total.usage.credits' AS check_name,
    3 AS expected,
    (SELECT COALESCE(SUM(credits), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.usage.input_tokens' AS check_name,
    123 AS expected,
    (SELECT COALESCE(SUM(input_tokens), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.usage.output_tokens' AS check_name,
    45 AS expected,
    (SELECT COALESCE(SUM(output_tokens), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.orders.amount_cents' AS check_name,
    16700 AS expected,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM orders) AS actual
  UNION ALL
  SELECT
    'total.orders.paid_amount_cents' AS check_name,
    6800 AS expected,
    (SELECT COALESCE(SUM(paid_amount_cents), 0) FROM orders) AS actual
  UNION ALL
  SELECT
    'constraint.devices.remaining_lte_total' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM devices WHERE credits_remaining > credits_total) AS actual
  UNION ALL
  SELECT
    'constraint.activation_counts.valid' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM activation_codes WHERE activations > max_activations) AS actual
  UNION ALL
  SELECT
    'constraint.usage.device_exists' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM usage_events u LEFT JOIN devices d ON d.device_id = u.device_id WHERE d.device_id IS NULL) AS actual
  UNION ALL
  SELECT
    'constraint.orders.fulfilled_has_license' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM orders WHERE status = 'fulfilled' AND (license_key IS NULL OR TRIM(license_key) = '')) AS actual
  UNION ALL
  SELECT
    'constraint.orders.paid_amount_matches' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM orders WHERE paid_amount_cents IS NOT NULL AND paid_amount_cents <> amount_cents) AS actual
  UNION ALL
  SELECT
    'unique.orders.wechat_transaction_id' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT wechat_transaction_id FROM orders WHERE wechat_transaction_id IS NOT NULL AND TRIM(wechat_transaction_id) <> '' GROUP BY wechat_transaction_id HAVING COUNT(*) > 1) duplicate_rows) AS actual
  UNION ALL
  SELECT
    'unique.orders.alipay_trade_no' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT alipay_trade_no FROM orders WHERE alipay_trade_no IS NOT NULL AND TRIM(alipay_trade_no) <> '' GROUP BY alipay_trade_no HAVING COUNT(*) > 1) duplicate_rows) AS actual
  UNION ALL
  SELECT
    'unique.payment_notifications.provider_notification_id' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT provider, notification_id FROM payment_notifications GROUP BY provider, notification_id HAVING COUNT(*) > 1) duplicate_rows) AS actual
)
SELECT
  check_name,
  expected,
  actual,
  CASE WHEN expected = actual THEN 'ok' ELSE 'mismatch' END AS result
FROM checks
ORDER BY result, check_name;

WITH checks AS (
  SELECT
    'table.devices.rows' AS check_name,
    1 AS expected,
    (SELECT COUNT(*) FROM `devices`) AS actual
  UNION ALL
  SELECT
    'table.activation_codes.rows' AS check_name,
    3 AS expected,
    (SELECT COUNT(*) FROM `activation_codes`) AS actual
  UNION ALL
  SELECT
    'table.usage_events.rows' AS check_name,
    1 AS expected,
    (SELECT COUNT(*) FROM `usage_events`) AS actual
  UNION ALL
  SELECT
    'table.orders.rows' AS check_name,
    3 AS expected,
    (SELECT COUNT(*) FROM `orders`) AS actual
  UNION ALL
  SELECT
    'table.payment_notifications.rows' AS check_name,
    2 AS expected,
    (SELECT COUNT(*) FROM `payment_notifications`) AS actual
  UNION ALL
  SELECT
    'total.devices.credits_total' AS check_name,
    12 AS expected,
    (SELECT COALESCE(SUM(credits_total), 0) FROM devices) AS actual
  UNION ALL
  SELECT
    'total.devices.credits_remaining' AS check_name,
    9 AS expected,
    (SELECT COALESCE(SUM(credits_remaining), 0) FROM devices) AS actual
  UNION ALL
  SELECT
    'total.usage.credits' AS check_name,
    3 AS expected,
    (SELECT COALESCE(SUM(credits), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.usage.input_tokens' AS check_name,
    123 AS expected,
    (SELECT COALESCE(SUM(input_tokens), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.usage.output_tokens' AS check_name,
    45 AS expected,
    (SELECT COALESCE(SUM(output_tokens), 0) FROM usage_events) AS actual
  UNION ALL
  SELECT
    'total.orders.amount_cents' AS check_name,
    16700 AS expected,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM orders) AS actual
  UNION ALL
  SELECT
    'total.orders.paid_amount_cents' AS check_name,
    6800 AS expected,
    (SELECT COALESCE(SUM(paid_amount_cents), 0) FROM orders) AS actual
  UNION ALL
  SELECT
    'constraint.devices.remaining_lte_total' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM devices WHERE credits_remaining > credits_total) AS actual
  UNION ALL
  SELECT
    'constraint.activation_counts.valid' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM activation_codes WHERE activations > max_activations) AS actual
  UNION ALL
  SELECT
    'constraint.usage.device_exists' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM usage_events u LEFT JOIN devices d ON d.device_id = u.device_id WHERE d.device_id IS NULL) AS actual
  UNION ALL
  SELECT
    'constraint.orders.fulfilled_has_license' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM orders WHERE status = 'fulfilled' AND (license_key IS NULL OR TRIM(license_key) = '')) AS actual
  UNION ALL
  SELECT
    'constraint.orders.paid_amount_matches' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM orders WHERE paid_amount_cents IS NOT NULL AND paid_amount_cents <> amount_cents) AS actual
  UNION ALL
  SELECT
    'unique.orders.wechat_transaction_id' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT wechat_transaction_id FROM orders WHERE wechat_transaction_id IS NOT NULL AND TRIM(wechat_transaction_id) <> '' GROUP BY wechat_transaction_id HAVING COUNT(*) > 1) duplicate_rows) AS actual
  UNION ALL
  SELECT
    'unique.orders.alipay_trade_no' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT alipay_trade_no FROM orders WHERE alipay_trade_no IS NOT NULL AND TRIM(alipay_trade_no) <> '' GROUP BY alipay_trade_no HAVING COUNT(*) > 1) duplicate_rows) AS actual
  UNION ALL
  SELECT
    'unique.payment_notifications.provider_notification_id' AS check_name,
    0 AS expected,
    (SELECT COUNT(*) FROM (SELECT provider, notification_id FROM payment_notifications GROUP BY provider, notification_id HAVING COUNT(*) > 1) duplicate_rows) AS actual
)
SELECT
  CASE WHEN SUM(CASE WHEN expected <> actual THEN 1 ELSE 0 END) = 0 THEN 'ok' ELSE 'mismatch' END AS verification_status,
  SUM(CASE WHEN expected <> actual THEN 1 ELSE 0 END) AS mismatches,
  COUNT(*) AS checks
FROM checks;
