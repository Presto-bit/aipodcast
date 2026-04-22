-- 将 users.plan 重命名为 users.acct_tier（应用层不再使用含 plan 的列名）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_valid_ck') THEN
    ALTER TABLE users DROP CONSTRAINT users_plan_valid_ck;
  END IF;
END $$;

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
  END IF;
END $$;

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
