import { STUDIO_ACK_GENERATE, STUDIO_ACK_REVISE } from "./studioTimeline";
import type { StudioWork, WorkStatus } from "./studioWorkTypes";

export const STUDIO_WORK_SCHEMA_VERSION = 4;

/** v3 草稿态：含已废弃的 briefing / planned */
export function isDraftLikeStatus(status: WorkStatus): boolean {
  return status === "draft" || status === "briefing" || status === "planned";
}

function backfillTimelineAnchors(work: StudioWork): StudioWork {
  const jobRuns = (work.agentRuns ?? []).filter(
    (r) => r.tool === "generate" || r.tool === "revise"
  );
  const ackIds: string[] = [];
  for (const turn of work.agentTurns) {
    if (turn.role !== "assistant") continue;
    if (turn.content === STUDIO_ACK_GENERATE || turn.content === STUDIO_ACK_REVISE) {
      ackIds.push(turn.id);
    }
  }

  const runs = (work.agentRuns ?? []).map((run, i) => {
    if (run.anchorTurnId) return run;
    if (run.tool !== "generate" && run.tool !== "revise") return run;
    const jobIndex = jobRuns.findIndex((r) => r.id === run.id);
    const anchorTurnId = jobIndex >= 0 ? ackIds[jobIndex] : undefined;
    return anchorTurnId ? { ...run, anchorTurnId } : run;
  });

  const versions = work.versions.map((v, i) => {
    if (v.sourceRunId) return v;
    const run = jobRuns[i];
    return run ? { ...v, sourceRunId: run.id } : v;
  });

  let pendingPatch = work.pendingPatch;
  if (pendingPatch && !pendingPatch.sourceRunId) {
    const lastRevise = [...jobRuns].reverse().find((r) => r.tool === "revise");
    if (lastRevise) {
      pendingPatch = { ...pendingPatch, sourceRunId: lastRevise.id };
    }
  }

  return { ...work, agentRuns: runs, versions, pendingPatch };
}

/** 读盘时迁移 schema（v3 状态机 + v4 时间线锚点回填） */
export function migrateStudioWorkToV3(work: StudioWork): StudioWork {
  let next = work;

  if ((next.schemaVersion ?? 0) < 3) {
    let status = next.status;
    if (status === "briefing" || status === "planned") {
      status = "draft";
    }
    next = {
      ...next,
      status,
      plan: undefined,
      postDoneFollowUpPending: undefined,
      postDoneFollowUpDone: undefined,
      postDoneCoach: undefined,
      postDoneCoachStreaming: undefined,
      schemaVersion: 3
    };
  }

  if ((next.schemaVersion ?? 0) < STUDIO_WORK_SCHEMA_VERSION) {
    next = backfillTimelineAnchors({ ...next, schemaVersion: STUDIO_WORK_SCHEMA_VERSION });
  }

  return next;
}
