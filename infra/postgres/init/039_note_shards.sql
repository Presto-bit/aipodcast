-- 资料内部分片（粗分片：索引/摘要/问答路由单元；用户仍见单条 note）
CREATE TABLE IF NOT EXISTS note_shards (
  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
  shard_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  char_start INT NOT NULL DEFAULT 0,
  char_end INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'auto',
  ordinal INT NOT NULL DEFAULT 0,
  summary_text TEXT,
  summary_at TIMESTAMPTZ,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_error TEXT,
  chunk_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (input_id, shard_id)
);

CREATE INDEX IF NOT EXISTS idx_note_shards_input ON note_shards (input_id);
