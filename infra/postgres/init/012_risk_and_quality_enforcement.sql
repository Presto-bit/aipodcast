-- 认证风控字段补充默认与约束
ALTER TABLE user_auth_accounts
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_auth_accounts_failed_attempts_nonnegative_ck') THEN
    ALTER TABLE user_auth_accounts
      ADD CONSTRAINT user_auth_accounts_failed_attempts_nonnegative_ck
      CHECK (failed_attempts >= 0);
  END IF;
END $$;

-- payment_orders 状态与币种收敛
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_status_valid_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_status_valid_ck
      CHECK (status IN ('created', 'paid', 'failed', 'refunded', 'cancelled', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_orders_currency_valid_ck') THEN
    ALTER TABLE payment_orders
      ADD CONSTRAINT payment_orders_currency_valid_ck
      CHECK (currency IN ('CNY', 'USD', 'EUR', 'JPY', 'HKD', 'SGD'));
  END IF;
END $$;

-- 查询优化索引
CREATE INDEX IF NOT EXISTS idx_user_auth_accounts_locked_until
  ON user_auth_accounts(locked_until);
CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
  ON users(phone_normalized);
