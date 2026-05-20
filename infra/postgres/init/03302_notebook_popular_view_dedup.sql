-- 热门浏览量：按访客账号去重，降低刷量（与 orchestrator increment_public_notebook_view 一致）
CREATE TABLE IF NOT EXISTS notebook_popular_view_dedup (
  viewer_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  notebook_name TEXT NOT NULL,
  last_increment_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (viewer_user_id, owner_user_id, notebook_name)
);

CREATE INDEX IF NOT EXISTS idx_notebook_popular_view_dedup_owner
  ON notebook_popular_view_dedup (owner_user_id, notebook_name);
