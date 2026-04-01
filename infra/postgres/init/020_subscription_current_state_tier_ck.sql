-- subscription_current_state.tier 与 subscription_manifest.USER_SUBSCRIPTION_TIERS / 018_basic_subscription_tier 对齐。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_current_state_tier_valid_ck') THEN
    ALTER TABLE subscription_current_state
      ADD CONSTRAINT subscription_current_state_tier_valid_ck
      CHECK (tier IN ('free', 'basic', 'pro', 'max'));
  END IF;
END $$;
