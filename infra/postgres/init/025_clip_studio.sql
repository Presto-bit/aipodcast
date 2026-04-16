-- 文稿剪辑（词级转写 + 导出）工程表
CREATE TABLE IF NOT EXISTS clip_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '未命名剪辑',
  audio_object_key TEXT,
  audio_filename TEXT,
  audio_mime TEXT,
  audio_size_bytes BIGINT,
  transcription_status TEXT NOT NULL DEFAULT 'idle',
  dashscope_task_id TEXT,
  transcription_error TEXT,
  transcript_raw_json JSONB,
  transcript_normalized JSONB,
  excluded_word_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  diarization_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  speaker_count INTEGER NOT NULL DEFAULT 2,
  channel_ids JSONB NOT NULL DEFAULT '[0]'::jsonb,
  export_status TEXT NOT NULL DEFAULT 'idle',
  export_object_key TEXT,
  export_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clip_projects_user_created ON clip_projects(user_id, created_at DESC);
