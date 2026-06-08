import { buildStudioDialogueTurnGroups } from "./studioDialogueTurnGroups";
import type {
  ManuscriptVersion,
  PendingPatch,
  StudioAgentTurn,
  StudioRun,
  StudioWork
} from "./studioWorkTypes";

export const STUDIO_ACK_GENERATE = "收到，开始写稿…";
export const STUDIO_ACK_REVISE = "收到，按你的意见改版…";

export function isStudioComposeAckTurn(turn: StudioAgentTurn): boolean {
  return (
    turn.intent === "compose_ack" ||
    turn.content === STUDIO_ACK_GENERATE ||
    turn.content === STUDIO_ACK_REVISE
  );
}

export function isStudioComposeWrapUpTurn(turn: StudioAgentTurn): boolean {
  if (turn.intent === "compose_wrap_up") return true;
  const head = turn.content.trim().slice(0, 8);
  return head.startsWith("写稿完成") || head.startsWith("改版完成");
}

/** Cursor 式写稿/改版收尾（按时间线排在成稿之后） */
export function buildStudioComposeWrapUp(tool: "compose" | "revise", variantCount = 3): string {
  if (tool === "revise") {
    return [
      "改版完成。",
      "你可以继续用一句话微调，例如：",
      "· 「再短一点，保留卖点」",
      "· 「语气更像博主聊天」",
      "· 「只改标题，正文别动」"
    ].join("\n");
  }
  const n = Math.max(variantCount, 2);
  const tabHint =
    n > 1 ? "点上方「痛点向 / 好奇向 / 数字向」可切换整篇文案，" : "";
  return [
    "写稿完成。",
    `${tabHint}标题、正文、互动与话题会一起切换。`,
    "接下来你可以：",
    "· 选一个方向继续改，例如「好奇向再口语一点」",
    "· 点击复制按钮带走成稿",
    "· 说「再写一版偏故事型」换全新方向"
  ].join("\n");
}

export type StudioTimelineDialogueItem = {
  kind: "dialogue";
  turn: StudioAgentTurn;
  groupId: string;
  isActive: boolean;
  userAnchor?: "active" | "history";
  ephemeral?: boolean;
};

export type StudioTimelineManuscriptItem = {
  kind: "manuscript";
  run: StudioRun;
  version: ManuscriptVersion | null;
  pendingPatch: PendingPatch | null;
  baseVersion: ManuscriptVersion | null;
  isActiveVersion: boolean;
};

export type StudioTimelineItem = StudioTimelineDialogueItem | StudioTimelineManuscriptItem;

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

/** 对话与锚定稿件卡按 agentTurns 顺序交错 → 纵向时间线 */
export function buildStudioTimeline(
  work: StudioWork,
  turns: StudioAgentTurn[] = work.agentTurns,
  options?: { hideManuscript?: boolean }
): StudioTimelineItem[] {
  const groups = buildStudioDialogueTurnGroups(turns);
  const anchors = runsByAnchor(work);
  const versions = versionByRunId(work);
  const items: StudioTimelineItem[] = [];
  const activeGroupId = groups[groups.length - 1]?.id;

  for (const group of groups) {
    const isActive = group.id === activeGroupId;

    items.push({
      kind: "dialogue",
      turn: group.userTurn,
      groupId: group.id,
      isActive,
      userAnchor: isActive ? "active" : "history"
    });

    for (const assistantTurn of group.assistantTurns) {
      items.push({
        kind: "dialogue",
        turn: assistantTurn,
        groupId: group.id,
        isActive,
        ephemeral: isStudioComposeAckTurn(assistantTurn)
      });

      if (options?.hideManuscript) continue;
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
