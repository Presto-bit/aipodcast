-- 支付状态机：禁止状态回退（DB 级兜底）
CREATE OR REPLACE FUNCTION fyv_payment_status_rank(s TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(s, 'unknown'))
    WHEN 'unknown' THEN 0
    WHEN 'created' THEN 1
    WHEN 'failed' THEN 2
    WHEN 'cancelled' THEN 2
    WHEN 'paid' THEN 3
    WHEN 'refunded' THEN 4
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION fyv_guard_payment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF lower(coalesce(OLD.status, 'unknown')) = lower(coalesce(NEW.status, 'unknown')) THEN
      RETURN NEW;
    END IF;
    IF lower(coalesce(OLD.status, 'unknown')) = 'refunded' AND lower(coalesce(NEW.status, 'unknown')) <> 'refunded' THEN
      RAISE EXCEPTION 'invalid payment status rollback: refunded -> %', NEW.status;
    END IF;
    IF lower(coalesce(OLD.status, 'unknown')) IN ('failed', 'cancelled')
       AND lower(coalesce(NEW.status, 'unknown')) IN ('created', 'unknown', 'paid') THEN
      RAISE EXCEPTION 'invalid payment status rollback: % -> %', OLD.status, NEW.status;
    END IF;
    IF lower(coalesce(OLD.status, 'unknown')) = 'paid'
       AND lower(coalesce(NEW.status, 'unknown')) IN ('created', 'unknown', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'invalid payment status rollback: paid -> %', NEW.status;
    END IF;
    IF fyv_payment_status_rank(NEW.status) < fyv_payment_status_rank(OLD.status) THEN
      RAISE EXCEPTION 'invalid payment status rollback(rank): % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payment_status_transition ON payment_orders;
CREATE TRIGGER trg_guard_payment_status_transition
BEFORE UPDATE OF status ON payment_orders
FOR EACH ROW
EXECUTE FUNCTION fyv_guard_payment_status_transition();

-- 支付回调触发的订阅事件幂等键（同一订单事件+事件类型仅一条）
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_events_payment_event_once
  ON subscription_events(source, order_event_id, event_type)
  WHERE source = 'payment_webhook' AND order_event_id IS NOT NULL;

-- 金额/结算模型补强（可选字段，向前兼容）
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate_snapshot NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS refunded_amount_cents BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_settlement_amount_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_settlement_amount_nonnegative_ck
      CHECK (settlement_amount_cents IS NULL OR settlement_amount_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_refunded_amount_nonnegative_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_refunded_amount_nonnegative_ck
      CHECK (refunded_amount_cents IS NULL OR refunded_amount_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_refunded_not_exceed_paid_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_refunded_not_exceed_paid_ck
      CHECK (refunded_amount_cents IS NULL OR refunded_amount_cents <= amount_cents);
  END IF;
END $$;
