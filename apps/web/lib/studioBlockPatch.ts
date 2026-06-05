/** 块级改版前缀：约束 Job 只动标题与正文，保留话题/封面结构 */
const BLOCK_PATCH_PREFIX =
  "【块级改版】仅修改标题(title)与正文(body)块；话题(hashtags)与封面说明(coverBrief)保持原样；";

/**
 * 将用户改版意见包装为块级 patch 指令（惊艳重写、对话改版共用）。
 */
export function buildBlockPatchOpinion(opinion: string): string {
  const trimmed = opinion.trim();
  if (!trimmed) return BLOCK_PATCH_PREFIX;
  if (trimmed.startsWith("【块级改版】")) return trimmed;
  return `${BLOCK_PATCH_PREFIX}${trimmed}`;
}
