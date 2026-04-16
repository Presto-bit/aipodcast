-- 精剪时间线、工程快照/协作备注、整句重录、听感质检（JSONB 可渐进演进）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS timeline_json jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS studio_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS collaboration_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS retake_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS qc_report jsonb;
