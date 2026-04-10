-- 登录主键 user_id；支持邮箱/用户名；手机号可选（绑定/找回）
-- 已有库升级：执行后新用户可无手机号注册；老用户 phone 仍保留。

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_not_blank_ck;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone_nonempty
  ON users(phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_ci
  ON users(lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_ci
  ON users(lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_created
  ON email_verification_tokens(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_email_verification_tokens_hash
  ON email_verification_tokens(token_hash)
  WHERE consumed_at IS NULL;
