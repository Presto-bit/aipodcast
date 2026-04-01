-- P0: 订单业务键强幂等（同 provider + provider_order_id 不可重复）
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_provider_order
  ON payment_orders(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL AND btrim(provider_order_id) <> '';

-- P0: 支付类订阅事件必须关联订单事件号
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_payment_requires_order_ck') THEN
    ALTER TABLE subscription_events
      ADD CONSTRAINT subscription_events_payment_requires_order_ck
      CHECK (
        NOT (source = 'payment_webhook' AND event_type LIKE 'payment_%')
        OR (order_event_id IS NOT NULL AND btrim(order_event_id) <> '')
      );
  END IF;
END $$;

-- P0: 退款明细表（支持部分退款/多次退款）
CREATE TABLE IF NOT EXISTS payment_refunds (
  id BIGSERIAL PRIMARY KEY,
  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'unknown',
  refund_id TEXT NOT NULL,
  refund_status TEXT NOT NULL DEFAULT 'processed',
  refunded_amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  refunded_at TIMESTAMPTZ,
  reason TEXT,
  trace_id TEXT,
  request_id TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_refunds_amount_nonnegative_ck CHECK (refunded_amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_provider_refund_id
  ON payment_refunds(provider, refund_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_order_created
  ON payment_refunds(order_event_id, created_at DESC);

-- P0/P1: webhook 载荷分层保存（脱敏版 + 可选原文）
ALTER TABLE payment_webhook_deliveries
  ADD COLUMN IF NOT EXISTS payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb;

-- P1: 归一手机号自动维护
CREATE OR REPLACE FUNCTION fyv_normalize_phone_text(s TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT regexp_replace(coalesce(s, ''), '\D', '', 'g')
$$;

CREATE OR REPLACE FUNCTION fyv_users_phone_normalized_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := fyv_normalize_phone_text(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_phone_normalized ON users;
CREATE TRIGGER trg_users_phone_normalized
BEFORE INSERT OR UPDATE OF phone ON users
FOR EACH ROW
EXECUTE FUNCTION fyv_users_phone_normalized_trigger();

-- P1: 账号安全事件审计
CREATE TABLE IF NOT EXISTS auth_account_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auth_service',
  actor_phone TEXT,
  reason TEXT,
  trace_id TEXT,
  request_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_account_events_user_created
  ON auth_account_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_account_events_phone_created
  ON auth_account_events(phone, created_at DESC);
