import { nextVersionLabel } from "./studioDeliverable";
import { diffManuscriptChangedKeys } from "./studioPatchDiff";
import { indexByKindForApply } from "./studioPatchApplyMerge";
import type { ManuscriptBlock, ManuscriptVersion, PendingPatch, StudioWork } from "./studioWorkTypes";

/** 尚无已采纳版本时的首稿 pendingPatch（非相对旧稿的改版 diff） */
export function isStudioFirstDraftPatch(work: StudioWork, patch: PendingPatch): boolean {
  if (work.versions.length > 0) {
    return !work.versions.some((v) => v.id === patch.fromVersionId);
  }
  return true;
}

export function buildPendingPatchFromBlocks(params: {
  fromVersionId: string;
  baseBlocks: ManuscriptBlock[];
  proposedBlocks: ManuscriptBlock[];
  summary: string;
  reason: string;
  sourceRunId: string;
  qualityNote?: string;
}): PendingPatch {
  const changedKeys = diffManuscriptChangedKeys(params.baseBlocks, params.proposedBlocks);
  return {
    fromVersionId: params.fromVersionId,
    proposedBlocks: params.proposedBlocks,
    changedKeys,
    summary: params.summary,
    reason: params.reason,
    qualityNote: params.qualityNote,
    sourceRunId: params.sourceRunId,
    selections: changedKeys
  };
}

/** 合并 patch：仅 selected keys 取自 proposed，其余保留 base */
export function mergePatchBlocks(
  base: ManuscriptBlock[],
  proposed: ManuscriptBlock[],
  selectedKeys: Set<string>
): ManuscriptBlock[] {
  const proposedMap = indexByKindForApply(proposed);
  const titleIdx = { n: 0 };
  return base.map((b) => {
    const idx = b.kind === "title" ? titleIdx.n++ : 0;
    const key = b.kind === "title" ? `title:${idx}` : b.kind === "body" ? "body:p:0" : b.kind;
    if (selectedKeys.has(key) && proposedMap.has(key)) {
      return proposedMap.get(key)!;
    }
    return b;
  });
}

export function applyPendingPatch(
  work: StudioWork,
  patch: PendingPatch,
  options: { partial: boolean; selectedKeys?: Set<string> }
): StudioWork {
  const base =
    patch.fromVersionId
      ? work.versions.find((v) => v.id === patch.fromVersionId)
      : null;
  const baseBlocks = base?.blocks ?? [];
  const keys =
    options.partial && options.selectedKeys?.size
      ? options.selectedKeys
      : new Set(patch.changedKeys ?? patch.selections ?? []);

  const merged =
    baseBlocks.length > 0
      ? mergePatchBlocks(baseBlocks, patch.proposedBlocks, keys)
      : patch.proposedBlocks;

  const versionId = crypto.randomUUID();
  const version: ManuscriptVersion = {
    id: versionId,
    label: nextVersionLabel(work.versions),
    createdAt: Date.now(),
    blocks: merged,
    primaryTitleIndex: base?.primaryTitleIndex ?? 0,
    sourceRunId: patch.sourceRunId
  };

  return {
    ...work,
    status: "ready",
    versions: [...work.versions, version],
    activeVersionId: versionId,
    pendingPatch: undefined,
    runPhase: undefined,
    error: undefined
  };
}

export function discardPendingPatch(work: StudioWork): StudioWork {
  return { ...work, pendingPatch: undefined };
}
