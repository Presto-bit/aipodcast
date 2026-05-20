-- 火山录音识别 request.corpus：热词 + 场景上下文
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS asr_corpus_hotwords jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS asr_corpus_scene text;
