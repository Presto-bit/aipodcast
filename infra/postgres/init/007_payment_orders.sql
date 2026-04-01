CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  billing_cycle TEXT,
  status TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'unknown',
  created_at_unix BIGINT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_phone_created_at
  ON payment_orders(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created_at
  ON payment_orders(user_id, created_at DESC);

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE payment_orders po
SET user_id = u.id
FROM users u
WHERE po.user_id IS NULL
  AND po.phone = u.phone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_phone_not_blank_ck'
  ) THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_phone_not_blank_ck
      CHECK (length(btrim(COALESCE(phone, ''))) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_tier_valid_ck'
  ) THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_tier_valid_ck
      CHECK (tier IN ('free', 'pro', 'max'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_amount_nonnegative_ck'
  ) THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_amount_nonnegative_ck
      CHECK (amount_cents >= 0);
  END IF;
END $$;
