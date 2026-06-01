-- Gugu Gateway SQLite to MySQL data export.
-- Generated at: 2026-05-27T10:20:14.412Z
-- Source SQLite: D:\Claude Code\claude-code-gugu\.tmp\gateway-backup-test\gateway.sqlite
-- Apply schema first: mysql ... gugu_gateway < deploy/mysql/schema.sql
-- Import only into an empty dry-run database until cutover is approved.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- devices
-- devices: 0 rows

-- activation_codes
INSERT INTO `activation_codes` (`license_key`, `plan`, `credits_total`, `expires_at`, `max_activations`, `activations`, `disabled_at`, `created_at`, `package_id`, `activation_kind`) VALUES
('GUGU-24DAA65ADDB2F57BFB022EEE', 'pro', 600, '2026-06-27 09:54:47.666', 1, 0, NULL, '2026-05-27 09:54:47.666', 'pro-monthly', 'subscription');

-- usage_events
-- usage_events: 0 rows

-- orders
-- orders: 0 rows

-- payment_notifications
-- payment_notifications: 0 rows

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;

