-- 用量事件（任务完成/失败等），供后台汇总与成本分析
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  phone TEXT,
  job_type TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT 'job_terminal',
  status TEXT,
  quantity NUMERIC(20, 4) NOT NULL DEFAULT 1,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_phone_created ON usage_events(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_job_type_created ON usage_events(job_type, created_at DESC);
