/** Studio V2 — 探索模式 vs 审阅模式 */

export type StudioEditorMode = "explore" | "review";

export const STUDIO_DEFAULT_EDITOR_MODE: StudioEditorMode = "explore";

export function isExploreMode(mode: StudioEditorMode | undefined): boolean {
  return (mode ?? STUDIO_DEFAULT_EDITOR_MODE) === "explore";
}

/** 探索模式：自动 Apply；审阅模式：需用户确认 */
export function shouldAutoApplyPatch(mode: StudioEditorMode | undefined): boolean {
  return isExploreMode(mode);
}

/** qualityNote 仅审阅模式展示 */
export function shouldShowQualityNote(mode: StudioEditorMode | undefined): boolean {
  return !isExploreMode(mode);
}
