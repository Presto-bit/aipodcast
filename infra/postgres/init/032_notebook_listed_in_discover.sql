-- 公开分享 vs 发现/热门展示：listed_in_discover 为真时才进入热门列表
ALTER TABLE user_notebooks
  ADD COLUMN IF NOT EXISTS listed_in_discover BOOLEAN NOT NULL DEFAULT FALSE;

-- 已有「可公开访问」的笔记本：保持原先会出现在热门中的行为
UPDATE user_notebooks
SET listed_in_discover = TRUE
WHERE is_public = TRUE
  AND LOWER(COALESCE(public_access, '')) IN ('read_only', 'edit')
  AND listed_in_discover IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_user_notebooks_discover_views
  ON user_notebooks (listed_in_discover, view_count DESC)
  WHERE listed_in_discover = TRUE;
