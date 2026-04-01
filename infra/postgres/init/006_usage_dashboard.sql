-- 006_usage_dashboard.sql
-- 后台看板查询优化：补充 usage_events 索引（兼容已有表结构）

CREATE INDEX IF NOT EXISTS idx_usage_events_metric_created
  ON usage_events(metric, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_status_created
  ON usage_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_job_created
  ON usage_events(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_meta_gin
  ON usage_events USING GIN (meta);
