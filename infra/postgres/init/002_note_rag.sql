-- 笔记异步摘要 + 勾选范围内向量检索（编排器启动时亦会 IF NOT EXISTS 幂等补齐）
ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_summary TEXT;
ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_body_hash TEXT;

CREATE TABLE IF NOT EXISTS note_rag_chunks (
  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding JSONB NOT NULL,
  PRIMARY KEY (input_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_note_rag_chunks_input ON note_rag_chunks (input_id);
