-- 笔记软删除：回收站与恢复
ALTER TABLE inputs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inputs_note_deleted ON inputs (deleted_at)
  WHERE input_type IN ('note_text', 'note_file');
