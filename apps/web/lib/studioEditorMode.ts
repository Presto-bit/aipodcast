/** Studio V2 — 探索模式 vs 审阅模式 */

export type StudioEditorMode = "explore" | "review";

export const STUDIO_DEFAULT_EDITOR_MODE: StudioEditorMode = "review";

export function isExploreMode(mode: StudioEditorMode | undefined): boolean {
  return (mode ?? STUDIO_DEFAULT_EDITOR_MODE) === "explore";
}

/**
 * 探索：首稿 + 改版均自动采纳。
 * 审阅：仅改版需确认；首稿仍自动落稿。
 */
export function shouldAutoApplyPatch(
  mode: StudioEditorMode | undefined,
  options?: { forceReview?: boolean; isFirstDraft?: boolean }
): boolean {
  if (options?.forceReview) return false;
  if (isExploreMode(mode)) return true;
  if (options?.isFirstDraft) return true;
  return false;
}

/** qualityNote 仅审阅模式展示 */
export function shouldShowQualityNote(mode: StudioEditorMode | undefined): boolean {
  return !isExploreMode(mode);
}
