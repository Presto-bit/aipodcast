import type { ManuscriptVersion, StudioWork } from "./studioWorkTypes";

export type StudioGeneratingUiMode = "progress" | "hold-existing" | null;

/** 稿件区：生成中展示进度/保留旧稿，成稿后展示成品 */
export function shouldShowStudioManuscriptSection(
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

/** 生成中 UI：无旧稿仅进度；有旧稿保留文档视图 */
export function studioGeneratingUiMode(
  work: StudioWork,
  activeVersion: ManuscriptVersion | null
): StudioGeneratingUiMode {
  if (work.status !== "generating") return null;
  return (activeVersion?.blocks.length ?? 0) > 0 ? "hold-existing" : "progress";
}

/** @deprecated 使用 shouldShowStudioManuscriptSection */
export function shouldShowStudioCanvas(
  work: StudioWork,
  activeVersion: ManuscriptVersion | null,
  options?: { showFeatureNudge?: boolean }
): boolean {
  return shouldShowStudioManuscriptSection(work, activeVersion, options);
}
