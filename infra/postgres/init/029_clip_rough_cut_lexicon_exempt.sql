-- 粗剪：嘉宾名 / 公司名 / 专业词豁免（不计入口癖高亮与规则建议）
ALTER TABLE clip_projects
  ADD COLUMN IF NOT EXISTS rough_cut_lexicon_exempt jsonb NOT NULL DEFAULT '[]'::jsonb;
