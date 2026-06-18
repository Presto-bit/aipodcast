-- UV 分区：营销页 / 工作台；同设备同日可分别计入不同 zone
ALTER TABLE site_page_views
  ADD COLUMN IF NOT EXISTS uv_zone TEXT NOT NULL DEFAULT 'other';

CREATE INDEX IF NOT EXISTS idx_site_page_views_zone_sh_day
  ON site_page_views (
    uv_zone,
    (((created_at AT TIME ZONE 'Asia/Shanghai')::date))
  );

CREATE INDEX IF NOT EXISTS idx_site_page_views_dedupe_zone_sh_day
  ON site_page_views (
    (NULLIF(TRIM(device_visitor_id), '')),
    uv_zone,
    (((created_at AT TIME ZONE 'Asia/Shanghai')::date))
  );
