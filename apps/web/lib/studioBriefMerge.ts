import { normalizeStudioComposeBrief } from "./studioComposeBrief";

const FIELD_CHIP_RE = /^(受众|卖点|场景|主题)[：:]\s*(.+)$/;
const WRITE_INTENT_RE = /生成|成稿|创作一篇|写一篇|开始写|帮我写|我想创作|我想写/;

/**
 * Cursor 式 chip：在已有 brief 上追加字段，而非覆盖整段对话。
 * chip 为完整例句时与 prior 合并；「再试一次」补写稿意图。
 */
export function mergeBriefChipReply(existingBrief: string, chip: string): string {
  const base = existingBrief.trim();
  const chipText = chip.trim();
  if (!chipText) return normalizeStudioComposeBrief(base);
  if (!base) return normalizeStudioComposeBrief(chipText);

  if (/^(按已有信息|再试一次)/.test(chipText)) {
    if (!WRITE_INTENT_RE.test(base)) {
      return normalizeStudioComposeBrief(`我想写：${base}`);
    }
    return normalizeStudioComposeBrief(base);
  }

  if (/^直接开始写成稿/.test(chipText)) {
    if (!WRITE_INTENT_RE.test(base)) {
      return normalizeStudioComposeBrief(`我想写：${base}`);
    }
    return normalizeStudioComposeBrief(base);
  }

  const fieldMatch = chipText.match(FIELD_CHIP_RE);
  if (fieldMatch) {
    const field = fieldMatch[1]!;
    const value = fieldMatch[2]!.trim();
    if (field === "受众") {
      if (/受众|人群|读者/.test(base)) {
        return normalizeStudioComposeBrief(`${base}，${value}`);
      }
      return normalizeStudioComposeBrief(`${base}，受众${value}`);
    }
    if (field === "卖点") {
      return normalizeStudioComposeBrief(`${base}，卖点：${value}`);
    }
    if (field === "场景") {
      return normalizeStudioComposeBrief(`${base}，场景：${value}`);
    }
    if (field === "主题") {
      return normalizeStudioComposeBrief(`${base}，主题：${value}`);
    }
  }

  if (/^(给|我想|帮我)/.test(chipText) && chipText.length >= 10) {
    if (base.length <= chipText.length && !WRITE_INTENT_RE.test(base)) {
      return normalizeStudioComposeBrief(`${base}，${chipText}`);
    }
    return normalizeStudioComposeBrief(chipText);
  }

  return normalizeStudioComposeBrief(`${base}，${chipText}`);
}

/** 运营问答后可选：继续聊 / 开写 */
export const STUDIO_OPS_FOLLOWUP_CHIPS = ["直接开始写成稿", "继续问发布与推广细节"] as const;
