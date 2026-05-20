-- Shownotes 与音频精剪工程区分（title 可为上传文件名）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS project_kind TEXT NOT NULL DEFAULT 'clip';

UPDATE clip_projects
SET project_kind = 'shownotes'
WHERE project_kind = 'clip' AND trim(title) = 'Shownotes';

CREATE INDEX IF NOT EXISTS idx_clip_projects_user_kind_created
  ON clip_projects(user_id, project_kind, created_at DESC);
