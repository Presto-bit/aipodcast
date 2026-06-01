-- UV 设备去重：浏览器设备 ID（优先于 Cookie visitor_id）
ALTER TABLE site_page_views
  ADD COLUMN IF NOT EXISTS device_visitor_id TEXT;

CREATE INDEX IF NOT EXISTS idx_site_page_views_dedupe_sh_day
  ON site_page_views (
    (NULLIF(TRIM(device_visitor_id), '')),
    (((created_at AT TIME ZONE 'Asia/Shanghai')::date))
  );
