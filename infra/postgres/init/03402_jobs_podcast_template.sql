-- 全站「创作播客」模板：管理员可将成功成片标记为模板，供所有用户在创作页浏览。
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_podcast_template BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_jobs_podcast_template_list
  ON jobs (completed_at DESC NULLS LAST, created_at DESC)
  WHERE is_podcast_template IS TRUE
    AND deleted_at IS NULL
    AND status = 'succeeded';
