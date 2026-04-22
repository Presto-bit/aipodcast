-- 用户档位统一为 users.acct_tier，移除遗留 users.plan 列与约束。
-- 兼容：仅有 plan、仅有 acct_tier、二者并存（异常数据）、或二者皆无。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'plan'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'acct_tier'
  ) THEN
    ALTER TABLE users RENAME COLUMN plan TO acct_tier;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'acct_tier'
  ) THEN
    ALTER TABLE users ADD COLUMN acct_tier TEXT NOT NULL DEFAULT 'free';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'plan'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'acct_tier'
  ) THEN
    UPDATE users
    SET acct_tier = COALESCE(NULLIF(btrim(plan), ''), NULLIF(btrim(acct_tier), ''), 'free')
    WHERE plan IS NOT NULL AND btrim(plan) <> '';
    ALTER TABLE users DROP COLUMN plan;
  END IF;
END $$;

ALTER TABLE users DROP COLUMN IF EXISTS plan;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_valid_ck;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'acct_tier'
  ) AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_acct_tier_valid_ck') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_acct_tier_valid_ck
      CHECK (acct_tier IN ('free', 'basic', 'pro', 'max'));
  END IF;
END $$;
