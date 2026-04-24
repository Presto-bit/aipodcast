-- 支付宝等异步通知「未入账但已对网关返回 success」或需人工跟进的场景，写入队列表供运营/脚本拉取。
CREATE TABLE IF NOT EXISTS payment_reconciliation_queue (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  out_trade_no TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_recon_q_reason_created
  ON payment_reconciliation_queue (reason, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_recon_q_out_trade_no
  ON payment_reconciliation_queue (out_trade_no);

CREATE INDEX IF NOT EXISTS idx_payment_recon_q_created
  ON payment_reconciliation_queue (created_at DESC);
