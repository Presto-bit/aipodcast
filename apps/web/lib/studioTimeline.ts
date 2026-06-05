import { buildStudioDialogueTurnGroups } from "./studioDialogueTurnGroups";
import type { StudioDialogueTurnGroup } from "./studioDialogueTurnGroups";
import type {
  ManuscriptVersion,
  PendingPatch,
  StudioAgentTurn,
  StudioRun,
  StudioWork
} from "./studioWorkTypes";

export const STUDIO_ACK_GENERATE = "收到，开始写稿…";
export const STUDIO_ACK_REVISE = "收到，按你的意见改版…";

export type StudioTimelineTurnItem = {
  kind: "turn-group";
  group: StudioDialogueTurnGroup;
  isActive: boolean;
};

export type StudioTimelineManuscriptItem = {
  kind: "manuscript";
  run: StudioRun;
  version: ManuscriptVersion | null;
  pendingPatch: PendingPatch | null;
  baseVersion: ManuscriptVersion | null;
  isActiveVersion: boolean;
};

export type StudioTimelineItem = StudioTimelineTurnItem | StudioTimelineManuscriptItem;

/** 从对话中解析最近一次 generate/revise 确认句 id */
export function resolveJobAnchorTurnId(
  turns: StudioAgentTurn[],
  tool: "generate" | "revise"
): string | undefined {
  const needle = tool === "generate" ? STUDIO_ACK_GENERATE : STUDIO_ACK_REVISE;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t?.role === "assistant" && t.content === needle) return t.id;
  }
  return undefined;
}

function versionByRunId(work: StudioWork): Map<string, ManuscriptVersion> {
  const map = new Map<string, ManuscriptVersion>();
  for (const v of work.versions) {
    if (v.sourceRunId) map.set(v.sourceRunId, v);
  }
  return map;
}

function runsByAnchor(work: StudioWork): Map<string, StudioRun[]> {
  const map = new Map<string, StudioRun[]>();
  for (const run of work.agentRuns ?? []) {
    if (!run.anchorTurnId) continue;
    const list = map.get(run.anchorTurnId) ?? [];
    list.push(run);
    map.set(run.anchorTurnId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt);
  }
  return map;
}

/** 对话组 + 锚定稿件卡 → 纵向时间线 */
export function buildStudioTimeline(
  work: StudioWork,
  turns: StudioAgentTurn[] = work.agentTurns
): StudioTimelineItem[] {
  const groups = buildStudioDialogueTurnGroups(turns);
  const anchors = runsByAnchor(work);
  const versions = versionByRunId(work);
  const items: StudioTimelineItem[] = [];
  const activeGroupId = groups[groups.length - 1]?.id;

  for (const group of groups) {
    items.push({
      kind: "turn-group",
      group,
      isActive: group.id === activeGroupId
    });

    for (const assistantTurn of group.assistantTurns) {
      const runs = anchors.get(assistantTurn.id) ?? [];
      for (const run of runs) {
        if (run.tool !== "generate" && run.tool !== "revise") continue;
        const version = versions.get(run.id) ?? null;
        const pendingPatch =
          work.pendingPatch?.sourceRunId === run.id ? work.pendingPatch : null;
        const baseVersion = pendingPatch
          ? work.versions.find((v) => v.id === pendingPatch.fromVersionId) ?? null
          : run.tool === "revise" && run.status === "running"
            ? work.versions.find((v) => v.id === work.activeVersionId) ?? null
            : null;

        items.push({
          kind: "manuscript",
          run,
          version,
          pendingPatch,
          baseVersion,
          isActiveVersion: Boolean(version && version.id === work.activeVersionId)
        });
      }
    }
  }

  return items;
}
