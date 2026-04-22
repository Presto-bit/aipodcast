-- 剪辑工程：可配置 loudnorm 目标整合响度 I（LUFS），用于修音 / 导出 / 词链试听
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS repair_loudness_i_lufs double precision;
