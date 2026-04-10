-- 用量事件与用户主键对齐：独立 user_id（UUID），phone 仅作冗余展示/兼容旧数据

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_user_id_created ON usage_events(user_id, created_at DESC);

-- 回填：按手机号关联 users；phone 已为 UUID 文本时直接转换
UPDATE usage_events ue
SET user_id = u.id
FROM users u
WHERE ue.user_id IS NULL
  AND ue.phone IS NOT NULL
  AND btrim(ue.phone) <> ''
  AND (u.phone = ue.phone OR u.phone_normalized = regexp_replace(ue.phone, '[^0-9]', '', 'g'));

UPDATE usage_events
SET user_id = phone::uuid
WHERE user_id IS NULL
  AND phone ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
