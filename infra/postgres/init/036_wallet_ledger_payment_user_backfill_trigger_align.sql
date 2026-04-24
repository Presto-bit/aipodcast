-- 钱包流水账（append-only，与 user_wallet_balance 变更同步写入应用层）
CREATE TABLE IF NOT EXISTS user_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  delta_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  entry_type TEXT NOT NULL,
  ref_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_wallet_ledger_user_created
  ON user_wallet_ledger (user_id, created_at DESC);

-- 历史订单：按当前 users.phone 回填 user_id，便于仅按 user_id 查询用户订单
UPDATE payment_orders po
SET user_id = u.id
FROM users u
WHERE po.user_id IS NULL
  AND po.phone IS NOT NULL
  AND btrim(po.phone) <> ''
  AND u.phone = po.phone;

-- 支付状态 rank / 触发器：与 app.models._payment_status_rank / _is_payment_status_transition_allowed 对齐
CREATE OR REPLACE FUNCTION fyv_payment_status_rank(s TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(s, 'unknown')))
    WHEN 'unknown' THEN 0
    WHEN 'created' THEN 1
    WHEN 'pending_payment' THEN 2
    WHEN 'authorized' THEN 3
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

CREATE OR REPLACE FUNCTION fyv_guard_payment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  o text := lower(btrim(coalesce(OLD.status, 'unknown')));
  n text := lower(btrim(coalesce(NEW.status, 'unknown')));
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF o = n THEN
      RETURN NEW;
    END IF;
    IF o IN ('refunded', 'chargeback') AND n IS DISTINCT FROM o THEN
      RAISE EXCEPTION 'invalid payment status rollback: % -> %', OLD.status, NEW.status;
    END IF;
    IF o IN ('failed', 'cancelled', 'expired', 'closed')
       AND n IN ('created', 'unknown', 'pending_payment', 'authorized', 'paid') THEN
      RAISE EXCEPTION 'invalid payment status rollback: % -> %', OLD.status, NEW.status;
    END IF;
    IF o = 'paid'
       AND n IN ('created', 'unknown', 'pending_payment', 'authorized', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'invalid payment status rollback: paid -> %', NEW.status;
    END IF;
    IF o = 'partially_refunded'
       AND n IN ('created', 'unknown', 'pending_payment', 'authorized', 'paid') THEN
      RAISE EXCEPTION 'invalid payment status rollback: partially_refunded -> %', NEW.status;
    END IF;
    IF fyv_payment_status_rank(n) < fyv_payment_status_rank(o) THEN
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
