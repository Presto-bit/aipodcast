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

/** 选中正文片段的局部改版前缀 */
export function buildSelectionPatchOpinion(selectedText: string, opinion: string): string {
  const snippet = selectedText.trim().slice(0, 400);
  const note = opinion.trim() || "更口语、信息密度更高";
  return buildBlockPatchOpinion(
    `【块级改版·局部】仅修改 body 块中以下片段，其余段落保持原样：「${snippet}」。要求：${note}`
  );
}
