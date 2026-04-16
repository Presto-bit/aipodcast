-- 多段素材暂存（合并后再走转写）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS audio_staging_keys jsonb NOT NULL DEFAULT '[]'::jsonb;
