-- 按次分钟包剩余可消耗分钟（任务侧 FIFO 扣减）；旧行由 orchestrator ensure 脚本回填

ALTER TABLE user_payg_minute_grants
  ADD COLUMN IF NOT EXISTS minutes_remaining NUMERIC(12, 2);

UPDATE user_payg_minute_grants
SET minutes_remaining = minutes
WHERE minutes_remaining IS NULL;
