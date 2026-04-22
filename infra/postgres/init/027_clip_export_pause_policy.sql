-- 粗剪：导出时压缩超长词间静音（由工程 JSON 控制）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS export_pause_policy jsonb;
