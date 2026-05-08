-- 多段合并后仍保留各段对象键与顺序，供列表展示与重排后自动再合并
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS audio_source_segments jsonb NOT NULL DEFAULT '[]'::jsonb;
