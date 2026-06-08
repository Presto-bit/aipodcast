import { buildStudioBriefClarifyTurn } from "./studioBriefClarify";
import { buildStudioDialogueTurnGroups } from "./studioDialogueTurnGroups";
import { manuscriptTitleBlocks } from "./studioManuscriptView";
import type {
  ManuscriptBlock,
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
  const head = turn.content.trim().slice(0, 16);
  return (
    head.startsWith("写稿完成") ||
    head.startsWith("改版完成") ||
    head.startsWith("已按你的意见") ||
    head.startsWith("已生成") ||
    head.startsWith("成稿已就绪")
  );
}

/** 模板/空泛成稿后：温和追问 brief，而非报错 */
export function buildStudioBriefClarifyAfterReject(reason: "template" | "empty" = "template"): string {
  return buildStudioBriefClarifyTurn(reason).content;
}

export function buildStudioBriefClarifyAssistantTurn(
  reason: "template" | "empty",
  userMessage = "",
  taskSentence = ""
): StudioAgentTurn {
  const { content, suggestedReplies } = buildStudioBriefClarifyTurn(reason, userMessage, taskSentence);
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    intent: "brief_clarify",
    suggestedReplies,
    createdAt: Date.now()
  };
}

/** Cursor 式收尾：结果 → 看哪里 → 下一步（单行，各一句） */
export function buildStudioComposeWrapUp(
  tool: "compose" | "revise",
  blocks: ManuscriptBlock[] = [],
  variantCount = 3
): string {
  if (tool === "revise") {
    return "已按你的意见改完成稿。还不满意就继续在下方说；可以了就用复制按钮带走。";
  }
  const titles = manuscriptTitleBlocks(blocks);
  const labels = titles
    .map((t) => t.directionLabel?.trim())
    .filter(Boolean)
    .slice(0, 3);
  const count = Math.max(variantCount, titles.length) || variantCount;
  if (count > 1) {
    const dirText = labels.length >= 2 ? labels.join(" / ") : "多个写作方向";
    return `已生成 ${dirText} 成稿。先切换上方标签挑选，选中后直接在下方说怎么改。`;
  }
  return "成稿已就绪。要改语气或结构，直接在下方说；满意就复制带走。";
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
