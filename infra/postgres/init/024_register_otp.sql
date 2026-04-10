-- 邮箱验证码注册（方案 A）：OTP 挑战 + 验邮通过后一次性注册票据

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_email_otp_purpose CHECK (purpose = 'register')
);

CREATE INDEX IF NOT EXISTS idx_email_otp_email_purpose_active
  ON email_otp_challenges (lower(email), purpose, id DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS registration_tickets (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  invite_code_snapshot TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_tickets_hash
  ON registration_tickets (token_hash)
  WHERE consumed_at IS NULL;
