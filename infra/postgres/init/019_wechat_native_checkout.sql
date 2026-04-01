-- 微信 Native 扫码：商户单号 out_trade_no 与本地会话绑定，支付回调验额后履约。
CREATE TABLE IF NOT EXISTS wechat_native_checkout_sessions (
  out_trade_no TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'wallet')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  tier TEXT,
  billing_cycle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wechat_native_checkout_user_created
  ON wechat_native_checkout_sessions (user_id, created_at DESC);
