-- 扩展订阅档位：basic（入门月付档），与编排器 subscription_manifest / users.plan 对齐。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_valid_ck') THEN
    ALTER TABLE users DROP CONSTRAINT users_plan_valid_ck;
  END IF;
  ALTER TABLE users
    ADD CONSTRAINT users_plan_valid_ck
    CHECK (plan IN ('free', 'basic', 'pro', 'max'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_tier_valid_ck') THEN
    ALTER TABLE subscription_events DROP CONSTRAINT subscription_events_tier_valid_ck;
  END IF;
  ALTER TABLE subscription_events
    ADD CONSTRAINT subscription_events_tier_valid_ck
    CHECK (tier IN ('free', 'basic', 'pro', 'max'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_tier_valid_ck') THEN
    ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_tier_valid_ck;
  END IF;
  ALTER TABLE payment_orders
    ADD CONSTRAINT payment_orders_tier_valid_ck
    CHECK (tier IN ('free', 'basic', 'pro', 'max'));
END $$;
