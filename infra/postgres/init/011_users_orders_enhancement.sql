-- users 增强
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE users
SET phone_normalized = regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
WHERE phone_normalized IS NULL OR phone_normalized = '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone_normalized
  ON users(phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_valid_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_status_valid_ck
      CHECK (account_status IN ('active', 'disabled', 'deleted'));
  END IF;
END $$;

-- payment_orders 增强
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_schema_version TEXT NOT NULL DEFAULT 'v1';

UPDATE payment_orders
SET last_status_change_at = COALESCE(last_status_change_at, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_orders_provider_order_id
  ON payment_orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status_change
  ON payment_orders(status, last_status_change_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_currency_status
  ON payment_orders(currency, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_currency_not_blank_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_currency_not_blank_ck
      CHECK (length(btrim(COALESCE(currency, ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_channel_not_blank_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_channel_not_blank_ck
      CHECK (length(btrim(COALESCE(channel, ''))) > 0);
  END IF;
END $$;
