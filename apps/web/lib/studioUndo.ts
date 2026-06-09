/** Studio V2 — Apply 后一层 Undo */

import type { StudioWork, StudioUndoSnapshot } from "./studioWorkTypes";

export function captureUndoSnapshot(work: StudioWork): StudioUndoSnapshot {
  return {
    versions: work.versions.map((v) => ({ ...v, blocks: [...v.blocks] })),
    activeVersionId: work.activeVersionId,
    pendingPatch: work.pendingPatch ? { ...work.pendingPatch } : undefined,
    savedAt: Date.now()
  };
}

export function applyUndoSnapshot(work: StudioWork, snap: StudioUndoSnapshot): StudioWork {
  return {
    ...work,
    versions: snap.versions,
    activeVersionId: snap.activeVersionId,
    pendingPatch: snap.pendingPatch,
    undoSnapshot: undefined,
    status: snap.versions.length ? "ready" : "draft"
  };
}
