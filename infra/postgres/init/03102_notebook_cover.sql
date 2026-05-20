-- 笔记本首图：混合方案（auto / preset / upload）
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS cover_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS cover_preset_id TEXT;
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS cover_thumb_object_key TEXT;
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS cover_image_object_key TEXT;
