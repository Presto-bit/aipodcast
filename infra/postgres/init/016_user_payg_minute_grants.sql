-- 按次分钟包入账（与订阅订单分离；消耗顺序由业务层在扣量时实现）

CREATE TABLE IF NOT EXISTS user_payg_minute_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  minutes NUMERIC(12, 2) NOT NULL CHECK (minutes > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_payg_minute_grants_payment_event_id_key UNIQUE (payment_event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_payg_grants_user_expires
  ON user_payg_minute_grants (user_id, expires_at DESC);
