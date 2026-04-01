-- 订阅事件：语义与追踪字段
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_events_event_type_valid_ck') THEN
    ALTER TABLE subscription_events
      ADD CONSTRAINT subscription_events_event_type_valid_ck
      CHECK (event_type IN (
        'unknown',
        'subscription_set',
        'manual_set',
        'upgrade',
        'downgrade',
        'renew',
        'cancel',
        'refund',
        'expire',
        'payment_paid',
        'payment_failed',
        'payment_refunded'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_events_phone_type_created
  ON subscription_events(phone, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_trace
  ON subscription_events(trace_id);

-- 订单：补可追溯字段与查询索引
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_status_created
  ON payment_orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_trace
  ON payment_orders(trace_id);

-- 回调投递：幂等增强 + 审计增强
ALTER TABLE payment_webhook_deliveries
  ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_count BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

UPDATE payment_webhook_deliveries
SET first_received_at = COALESCE(first_received_at, received_at),
    last_received_at = COALESCE(last_received_at, received_at)
WHERE first_received_at IS NULL OR last_received_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_webhook_deliveries_provider_event_payload
  ON payment_webhook_deliveries(provider, event_id, payload_hash);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_deliveries_last_received
  ON payment_webhook_deliveries(last_received_at DESC);

-- 数据质量约束补充
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_provider_not_blank_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_provider_not_blank_ck
      CHECK (length(btrim(COALESCE(provider, ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_status_not_blank_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_status_not_blank_ck
      CHECK (length(btrim(COALESCE(status, ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_current_state_status_valid_ck') THEN
    ALTER TABLE subscription_current_state
      ADD CONSTRAINT subscription_current_state_status_valid_ck
      CHECK (status IN ('active', 'inactive', 'expired', 'payment_failed', 'unknown'));
  END IF;
END $$;

-- 归档表（在线保留后转存）
CREATE TABLE IF NOT EXISTS payment_webhook_deliveries_archive (LIKE payment_webhook_deliveries INCLUDING ALL);
CREATE TABLE IF NOT EXISTS usage_events_archive (LIKE usage_events INCLUDING ALL);
CREATE TABLE IF NOT EXISTS job_events_archive (LIKE job_events INCLUDING ALL);
CREATE TABLE IF NOT EXISTS subscription_events_archive (LIKE subscription_events INCLUDING ALL);
