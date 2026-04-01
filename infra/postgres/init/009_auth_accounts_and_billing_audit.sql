CREATE TABLE IF NOT EXISTS user_auth_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'unknown',
  signature_ok BOOLEAN NOT NULL DEFAULT FALSE,
  payload_hash TEXT NOT NULL,
  process_result TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_deliveries_event_received
  ON payment_webhook_deliveries(event_id, received_at DESC);

CREATE TABLE IF NOT EXISTS subscription_current_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  tier TEXT NOT NULL,
  billing_cycle TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'unknown',
  order_event_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_current_state_phone
  ON subscription_current_state(phone);

WITH latest AS (
  SELECT DISTINCT ON (COALESCE(user_id::text, phone))
    user_id, phone, tier, billing_cycle, source, order_event_id, effective_at, expires_at, created_at
  FROM subscription_events
  ORDER BY COALESCE(user_id::text, phone), created_at DESC, id DESC
)
INSERT INTO subscription_current_state
  (user_id, phone, tier, billing_cycle, status, effective_at, expires_at, source, order_event_id, updated_at)
SELECT
  COALESCE(latest.user_id, u.id) AS user_id,
  latest.phone,
  latest.tier,
  latest.billing_cycle,
  'active'::text AS status,
  latest.effective_at,
  latest.expires_at,
  latest.source,
  latest.order_event_id,
  NOW()
FROM latest
LEFT JOIN users u ON u.phone = latest.phone
WHERE COALESCE(latest.user_id, u.id) IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET
  phone = EXCLUDED.phone,
  tier = EXCLUDED.tier,
  billing_cycle = EXCLUDED.billing_cycle,
  status = EXCLUDED.status,
  effective_at = EXCLUDED.effective_at,
  expires_at = EXCLUDED.expires_at,
  source = EXCLUDED.source,
  order_event_id = EXCLUDED.order_event_id,
  updated_at = NOW();
