import { STUDIO_ACK_GENERATE, STUDIO_ACK_REVISE } from "./studioTimeline";
import type { StudioWork, WorkStatus } from "./studioWorkTypes";

/** v6：Studio V2 — 零配置 domain、探索模式、去 Tab */
export const STUDIO_WORK_SCHEMA_VERSION = 6;

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

  const runs = (work.agentRuns ?? []).map((run) => {
    if (run.anchorTurnId) return run;
    if (run.tool !== "generate" && run.tool !== "revise") return run;
    const jobIndex = jobRuns.findIndex((r) => r.id === run.id);
    const anchorTurnId = jobIndex >= 0 ? ackIds[jobIndex] : undefined;
    return anchorTurnId ? { ...run, anchorTurnId } : run;
  });

  let pendingPatch = work.pendingPatch;
  if (pendingPatch && !pendingPatch.sourceRunId) {
    const lastRevise = [...jobRuns].reverse().find((r) => r.tool === "revise");
    if (lastRevise) {
      pendingPatch = { ...pendingPatch, sourceRunId: lastRevise.id };
    }
  }

  return { ...work, agentRuns: runs, pendingPatch };
}

function migrateToV6(work: StudioWork): StudioWork {
  return {
    ...work,
    schemaVersion: STUDIO_WORK_SCHEMA_VERSION,
    editorMode: work.editorMode ?? "explore",
    domain: work.domain ?? (work.channel === "xhs" ? "social" : "general"),
    format: work.format ?? (work.channel === "xhs" ? "short_post" : "general"),
    plannerAssumptions: work.plannerAssumptions ?? [],
    undoSnapshot: undefined
  };
}

function migrateToV5(work: StudioWork): StudioWork {
  let status = work.status;
  if (status === "generating") status = "draft";
  if (status === "briefing" || status === "planned") status = "draft";

  return {
    ...work,
    schemaVersion: 5,
    status,
    versions: [],
    activeVersionId: "",
    pendingPatch: undefined,
    followUps: [],
    agentTrace: [],
    plan: undefined,
    postDoneFollowUpPending: undefined,
    postDoneFollowUpDone: undefined,
    postDoneCoach: undefined,
    postDoneCoachStreaming: undefined,
    runPhase: undefined
  };
}

/** 读盘时迁移 schema */
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

  if ((next.schemaVersion ?? 0) < 4) {
    next = backfillTimelineAnchors({ ...next, schemaVersion: 4 });
  }

  if ((next.schemaVersion ?? 0) < 5) {
    next = migrateToV5(next);
  }

  if ((next.schemaVersion ?? 0) < STUDIO_WORK_SCHEMA_VERSION) {
    next = migrateToV6(next);
  }

  return next;
}
