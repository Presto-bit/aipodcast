-- 彻底清除历史支付/订阅订单相关数据，并将所有账户钱包余额归零。
--
-- 适用：产品已取消「订阅收银 / 历史订单」留存需求后的库清理；执行前请全库备份，不可恢复。
-- 不删除 users、jobs、job_events（用量流水仍在 job_events 中）。

BEGIN;

DELETE FROM user_payg_minute_grants;
DELETE FROM user_wallet_topups;
DELETE FROM wallet_checkout_sessions;
DELETE FROM alipay_page_checkout_sessions;

DELETE FROM payment_webhook_deliveries;

DELETE FROM subscription_events;
DELETE FROM subscription_current_state;

-- payment_order_items / payment_refunds / payment_transactions 等对 payment_orders 多为 ON DELETE CASCADE
DELETE FROM payment_orders;

UPDATE user_wallet_balance SET balance_cents = 0, updated_at = NOW();

DO $$
BEGIN
  IF to_regclass('public.payment_webhook_deliveries_archive') IS NOT NULL THEN
    EXECUTE 'TRUNCATE payment_webhook_deliveries_archive';
  END IF;
  IF to_regclass('public.subscription_events_archive') IS NOT NULL THEN
    EXECUTE 'TRUNCATE subscription_events_archive';
  END IF;
END $$;

COMMIT;
