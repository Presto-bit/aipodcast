ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
UPDATE users
SET phone = CONCAT('migrated_', id::text)
WHERE phone IS NULL OR btrim(phone) = '';
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_not_blank_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_phone_not_blank_ck
      CHECK (length(btrim(COALESCE(phone, ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_valid_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_valid_ck
      CHECK (role IN ('user', 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_valid_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_plan_valid_ck
      CHECK (plan IN ('free', 'pro', 'max'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_billing_cycle_valid_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_billing_cycle_valid_ck
      CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'yearly'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  tier TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'unknown',
  billing_cycle TEXT,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  order_event_id TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  actor_phone TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_phone_created_at
  ON subscription_events(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_created_at
  ON subscription_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_type_created_at
  ON subscription_events(event_type, created_at DESC);

ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ;
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS order_event_id TEXT;

UPDATE subscription_events se
SET user_id = u.id
FROM users u
WHERE se.user_id IS NULL
  AND se.phone = u.phone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_phone_not_blank_ck') THEN
    ALTER TABLE subscription_events
      ADD CONSTRAINT subscription_events_phone_not_blank_ck
      CHECK (length(btrim(COALESCE(phone, ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_tier_valid_ck') THEN
    ALTER TABLE subscription_events
      ADD CONSTRAINT subscription_events_tier_valid_ck
      CHECK (tier IN ('free', 'pro', 'max'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_event_type_not_blank_ck') THEN
    ALTER TABLE subscription_events
      ADD CONSTRAINT subscription_events_event_type_not_blank_ck
      CHECK (length(btrim(COALESCE(event_type, ''))) > 0);
  END IF;
END $$;
