import type { StudioWork, WorkStatus } from "./studioWorkTypes";

export const STUDIO_WORK_SCHEMA_VERSION = 3;

/** v3 草稿态：含已废弃的 briefing / planned */
export function isDraftLikeStatus(status: WorkStatus): boolean {
  return status === "draft" || status === "briefing" || status === "planned";
}

/** 读盘时把 v2 作品迁到 v3（draft 状态机、去掉 plan / postDone） */
export function migrateStudioWorkToV3(work: StudioWork): StudioWork {
  if (work.schemaVersion === STUDIO_WORK_SCHEMA_VERSION) {
    return work;
  }

  let status = work.status;
  if (status === "briefing" || status === "planned") {
    status = "draft";
  }

  return {
    ...work,
    status,
    plan: undefined,
    postDoneFollowUpPending: undefined,
    postDoneFollowUpDone: undefined,
    postDoneCoach: undefined,
    postDoneCoachStreaming: undefined,
    schemaVersion: STUDIO_WORK_SCHEMA_VERSION
  };
}
