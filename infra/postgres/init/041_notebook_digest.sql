-- 笔记本级综述缓存（L0.5）
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS digest_json JSONB NOT NULL DEFAULT '{}'::jsonb;
