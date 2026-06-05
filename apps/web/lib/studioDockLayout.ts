import type { ManuscriptVersion, StudioWork } from "./studioWorkTypes";

/** 画布仅在成稿、生成中、改版对比、错误或特色引导时出现 */
export function shouldShowStudioCanvas(
  work: StudioWork,
  activeVersion: ManuscriptVersion | null,
  options?: { showFeatureNudge?: boolean }
): boolean {
  if (work.error) return true;
  if (work.pendingPatch) return true;
  if (work.status === "generating") return true;
  if (options?.showFeatureNudge) return true;
  if (work.status === "ready" || work.status === "shipped") {
    return (activeVersion?.blocks.length ?? 0) > 0;
  }
  return false;
}
