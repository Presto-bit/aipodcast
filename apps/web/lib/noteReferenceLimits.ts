/** 与 orchestrator `subscription_manifest.MAX_NOTE_REFS_BY_TIER` 一致 */

/** Basic / Pro / Max：风格与开头结尾等订阅档能力（不含 free、按量 payg） */
export function planIsBasicOrAbove(plan: string | undefined | null): boolean {
  const p = (plan || "free").trim().toLowerCase();
  return p === "basic" || p === "pro" || p === "max";
}

/** 打包下载作品（含批量）：Basic+ 或按量（payg）。分享链接不限档位。 */
export function planMayDownloadBundledWorks(plan: string | undefined | null): boolean {
  const p = (plan || "free").trim().toLowerCase();
  return planIsBasicOrAbove(plan) || p === "payg";
}

/** @deprecated 历史命名；分享已开放，仅下载仍受限。请用 planMayDownloadBundledWorks。 */
export function planMayShareOrDownloadWorks(plan: string | undefined | null): boolean {
  return planMayDownloadBundledWorks(plan);
}

/**
 * 进 TTS 前「口述润色」：与 `entitlement_matrix.tier_ai_polish_monthly_quota` 非 0 的档位一致
 * （且服务端 AI_POLISH_FEATURE_ENABLED 未关）。含 Basic+ 与 payg。
 */
export function mayUseAiPolishPlan(plan: string | undefined | null): boolean {
  return planMayDownloadBundledWorks(plan);
}

export function maxNotesForReferencePlan(plan: string | undefined | null): number {
  const p = (plan || "free").trim().toLowerCase();
  if (p === "max") return 12;
  if (p === "pro") return 6;
  if (p === "basic") return 3;
  if (p === "payg") return 1;
  return 1;
}

/** 与订阅页「知识库可参考资料条数」口径一致（payg / free 均为 1 条） */
export const NOTE_REFS_TIER_SUMMARY_ZH = "Free 1 / Basic 3 / Pro 6 / Max 12";

export function notesRefSelectionLimitMessage(cap: number): string {
  return `当前套餐最多勾选 ${cap} 本笔记作为资料（${NOTE_REFS_TIER_SUMMARY_ZH}）`;
}
