-- 资料章节（方案 C：章路由 + 摘要树）
CREATE TABLE IF NOT EXISTS note_chapters (
  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  level INT NOT NULL DEFAULT 1,
  char_start INT NOT NULL DEFAULT 0,
  char_end INT NOT NULL DEFAULT 0,
  parent_id TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  summary_text TEXT,
  summary_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (input_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_note_chapters_input ON note_chapters (input_id);
