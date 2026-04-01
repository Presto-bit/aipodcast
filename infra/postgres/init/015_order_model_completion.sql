-- 订单模型补齐：交易分层、商品快照、金额拆分、幂等键、审计字段

-- payment_orders: 关键字段补齐
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS amount_subtotal_cents BIGINT,
  ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payable_cents BIGINT,
  ADD COLUMN IF NOT EXISTS paid_cents BIGINT,
  ADD COLUMN IF NOT EXISTS source_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_subtotal_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_subtotal_nonnegative_ck
      CHECK (amount_subtotal_cents IS NULL OR amount_subtotal_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_discount_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_discount_nonnegative_ck
      CHECK (discount_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_tax_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_tax_nonnegative_ck
      CHECK (tax_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_payable_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_payable_nonnegative_ck
      CHECK (payable_cents IS NULL OR payable_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_paid_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_paid_nonnegative_ck
      CHECK (paid_cents IS NULL OR paid_cents >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_idempotency_key
  ON payment_orders(provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_client_request_id
  ON payment_orders(provider, client_request_id)
  WHERE client_request_id IS NOT NULL AND btrim(client_request_id) <> '';

-- 订单项快照（可用于后续对账/纠纷）
CREATE TABLE IF NOT EXISTS payment_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  product_id TEXT,
  sku TEXT,
  name TEXT,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  line_subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  payable_cents BIGINT NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_order_items_unit_price_nonnegative_ck CHECK (unit_price_cents >= 0),
  CONSTRAINT payment_order_items_quantity_positive_ck CHECK (quantity > 0),
  CONSTRAINT payment_order_items_line_subtotal_nonnegative_ck CHECK (line_subtotal_cents >= 0),
  CONSTRAINT payment_order_items_discount_nonnegative_ck CHECK (discount_cents >= 0),
  CONSTRAINT payment_order_items_tax_nonnegative_ck CHECK (tax_cents >= 0),
  CONSTRAINT payment_order_items_payable_nonnegative_ck CHECK (payable_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_order_items_line
  ON payment_order_items(order_event_id, line_no);

CREATE INDEX IF NOT EXISTS idx_payment_order_items_order
  ON payment_order_items(order_event_id);

-- 支付交易流水（订单与交易拆层）
CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'unknown',
  transaction_type TEXT NOT NULL DEFAULT 'payment',
  transaction_status TEXT NOT NULL DEFAULT 'unknown',
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  provider_transaction_id TEXT,
  idempotency_key TEXT,
  client_request_id TEXT,
  occurred_at TIMESTAMPTZ,
  trace_id TEXT,
  request_id TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_transactions_amount_nonnegative_ck CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_created
  ON payment_transactions(order_event_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_provider_trade_no
  ON payment_transactions(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL AND btrim(provider_transaction_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_idempotency_key
  ON payment_transactions(provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

-- 扩展 payment 状态机（与应用层保持一致）
CREATE OR REPLACE FUNCTION fyv_payment_status_rank(s TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(s, 'unknown'))
    WHEN 'unknown' THEN 0
    WHEN 'created' THEN 1
    WHEN 'pending_payment' THEN 2
    WHEN 'authorized' THEN 3
    WHEN 'captured' THEN 4
    WHEN 'paid' THEN 4
    WHEN 'partially_refunded' THEN 5
    WHEN 'refunded' THEN 6
    WHEN 'failed' THEN 6
    WHEN 'cancelled' THEN 6
    WHEN 'expired' THEN 6
    WHEN 'closed' THEN 6
    WHEN 'chargeback' THEN 7
    WHEN 'disputed' THEN 7
    ELSE 0
  END
$$;

