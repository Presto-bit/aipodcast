-- 剪辑建议反馈（反哺词表/prompt）、静音分析缓存
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS suggestion_feedback jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS silence_analysis jsonb;
