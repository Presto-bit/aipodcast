-- 各分段 object_key -> 归一化转写缓存，用于增量转写（避免对已转写分段重复 ASR）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS audio_segment_transcripts jsonb NOT NULL DEFAULT '{}'::jsonb;
