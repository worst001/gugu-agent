-- Gugu Gateway SQLite to MySQL data export.
-- Generated at: 2026-05-27T10:39:31.313Z
-- Source SQLite: D:\Claude Code\claude-code-gugu\.tmp\gateway-docker-dryrun-0527a\gateway.sqlite
-- Apply schema first: mysql ... gugu_gateway < deploy/mysql/schema.sql
-- Import only into an empty dry-run database until cutover is approved.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- devices
INSERT INTO `devices` (`device_id`, `device_token`, `plan`, `credits_total`, `credits_remaining`, `expires_at`, `license_key`, `app_version`, `platform`, `created_at`, `updated_at`, `last_seen_at`) VALUES
('docker-dryrun-device', 'gugu_ad2b9533-828b-468f-84ea-465980303e80_59a26a3344407afdfca64f4ab1c5b67f', 'pro', 12, 9, NULL, 'GUGU-E15A5581039D17DE95DCFED3', '0.1.16', 'docker', '2026-05-27 10:39:21.245', '2026-05-27 10:39:21.267', '2026-05-27 10:39:21.267');

-- activation_codes
INSERT INTO `activation_codes` (`license_key`, `plan`, `credits_total`, `expires_at`, `max_activations`, `activations`, `disabled_at`, `created_at`, `package_id`, `activation_kind`) VALUES
('GUGU-8DF674D28E43C665EE7A2B55', 'pro', 600, '2026-06-27 10:39:21.273', 1, 0, NULL, '2026-05-27 10:39:21.273', 'pro-monthly', 'subscription'),
('GUGU-B3C0CCDC80C15270447258DB', 'light', 180, '2026-06-27 10:39:21.277', 1, 0, NULL, '2026-05-27 10:39:21.277', 'light-monthly', 'subscription');
INSERT INTO `activation_codes` (`license_key`, `plan`, `credits_total`, `expires_at`, `max_activations`, `activations`, `disabled_at`, `created_at`, `package_id`, `activation_kind`) VALUES
('GUGU-E15A5581039D17DE95DCFED3', 'pro', 12, NULL, 1, 1, NULL, '2026-05-27 10:39:21.265', NULL, 'subscription');

-- usage_events
INSERT INTO `usage_events` (`id`, `device_id`, `kind`, `model`, `credits`, `input_tokens`, `output_tokens`, `created_at`, `metadata`) VALUES
(1, 'docker-dryrun-device', 'message', 'deepseek-v4-pro', 3, 123, 45, '2026-05-27 10:39:21.267', '{"fixture":"docker-dryrun","upstreamStatus":200}');

-- orders
INSERT INTO `orders` (`id`, `order_id`, `package_id`, `package_name`, `package_kind`, `plan`, `credits`, `amount_cents`, `currency`, `status`, `contact`, `license_key`, `order_token`, `payment_provider`, `payment_code_url`, `payment_expires_at`, `wechat_transaction_id`, `wechat_trade_state`, `wechat_success_time`, `alipay_trade_no`, `alipay_trade_status`, `alipay_success_time`, `paid_amount_cents`, `payment_payload`, `created_at`, `updated_at`, `paid_at`, `fulfilled_at`, `cancelled_at`) VALUES
(1, 'GUGU-20260527-C6B24894', 'pro-monthly', 'Pro', 'subscription', 'pro', 600, 4900, 'CNY', 'fulfilled', 'wx@example.com', 'GUGU-8DF674D28E43C665EE7A2B55', 'ord_YqT_h5qcGWxreibjpmP7-o7fk3xuHhiU', 'wechat', NULL, NULL, 'wx-fixture-tx', 'SUCCESS', '2026-05-27 05:00:00.000', NULL, NULL, NULL, 4900, '{"fixture":"wechat"}', '2026-05-27 10:39:21.270', '2026-05-27 10:39:21.273', '2026-05-27 05:00:00.000', '2026-05-27 10:39:21.273', NULL),
(2, 'GUGU-20260527-47A70382', 'light-monthly', '轻量版', 'subscription', 'light', 180, 1900, 'CNY', 'fulfilled', 'ali@example.com', 'GUGU-B3C0CCDC80C15270447258DB', 'ord_nq_BSuOf_ZO6PkWFUm9gVTlPrexM5ORp', 'alipay', NULL, NULL, NULL, NULL, NULL, 'ali-fixture-tx', 'TRADE_SUCCESS', '2026-05-27 06:00:00.000', 1900, '{"fixture":"alipay"}', '2026-05-27 10:39:21.275', '2026-05-27 10:39:21.277', '2026-05-27 06:00:00.000', '2026-05-27 10:39:21.277', NULL);
INSERT INTO `orders` (`id`, `order_id`, `package_id`, `package_name`, `package_kind`, `plan`, `credits`, `amount_cents`, `currency`, `status`, `contact`, `license_key`, `order_token`, `payment_provider`, `payment_code_url`, `payment_expires_at`, `wechat_transaction_id`, `wechat_trade_state`, `wechat_success_time`, `alipay_trade_no`, `alipay_trade_status`, `alipay_success_time`, `paid_amount_cents`, `payment_payload`, `created_at`, `updated_at`, `paid_at`, `fulfilled_at`, `cancelled_at`) VALUES
(3, 'GUGU-20260527-897AF942', 'max-monthly', 'Max', 'subscription', 'max', 1500, 9900, 'CNY', 'pending_payment', 'pending@example.com', NULL, 'ord_sWRw6l_lFQj93OxuqJI0HRABbaqeplL1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-05-27 10:39:21.279', '2026-05-27 10:39:21.279', NULL, NULL, NULL);

-- payment_notifications
INSERT INTO `payment_notifications` (`id`, `provider`, `notification_id`, `transaction_id`, `order_id`, `status`, `error_message`, `payload`, `created_at`, `updated_at`, `processed_at`) VALUES
(1, 'wechat', 'wx-fixture-notice', 'wx-fixture-tx', 'GUGU-20260527-C6B24894', 'processed', NULL, '{"fixture":true}', '2026-05-27 10:39:21.271', '2026-05-27 10:39:21.274', '2026-05-27 10:39:21.274'),
(2, 'alipay', 'ali-fixture-notice', 'ali-fixture-tx', 'GUGU-20260527-47A70382', 'processed', NULL, '{"fixture":true}', '2026-05-27 10:39:21.275', '2026-05-27 10:39:21.277', '2026-05-27 10:39:21.277');

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;

