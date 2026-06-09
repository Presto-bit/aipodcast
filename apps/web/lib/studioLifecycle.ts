import type { StudioWork } from "./studioWorkTypes";

/** 制品生命周期（决策用，与展示 status 解耦） */
export type StudioLifecycle = "empty" | "running" | "committed" | "reviewing";

export function deriveStudioLifecycle(work: StudioWork): StudioLifecycle {
  if (work.status === "generating") return "running";
  const hasVersions = work.versions.length > 0;
  const hasPending = Boolean(work.pendingPatch);
  if (hasVersions) return hasPending ? "reviewing" : "committed";
  if (hasPending) return "reviewing";
  return "empty";
}

export function hasCommittedManuscript(work: StudioWork): boolean {
  return work.versions.length > 0;
}

/** 持久化不变量：无版本不应处于 ready（僵尸态） */
export function normalizeStudioWorkLifecycle(work: StudioWork): StudioWork {
  if (work.versions.length > 0 || work.status === "generating") return work;
  if (work.status === "ready" || work.status === "shipped") {
    return { ...work, status: "draft" };
  }
  return work;
}
