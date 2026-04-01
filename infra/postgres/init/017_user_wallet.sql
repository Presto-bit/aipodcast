-- 账户余额（充值入账、按用量扣减；与订阅档位独立）

CREATE TABLE IF NOT EXISTS user_wallet_balance (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_wallet_topups (
  payment_event_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 模拟收银：将 checkout_id 与金额绑定，防止 complete 阶段篡改金额
CREATE TABLE IF NOT EXISTS wallet_checkout_sessions (
  checkout_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_checkout_user_created
  ON wallet_checkout_sessions (user_id, created_at DESC);
