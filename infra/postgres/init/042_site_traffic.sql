-- 站点 UV 原始事件（按 Asia/Shanghai 日历日聚合；管理端 T+1 展示）
CREATE TABLE IF NOT EXISTS site_page_views (
  id BIGSERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  path TEXT NOT NULL DEFAULT '/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_page_views_created ON site_page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_page_views_visitor_created ON site_page_views(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_page_views_sh_day ON site_page_views(((created_at AT TIME ZONE 'Asia/Shanghai')::date));
