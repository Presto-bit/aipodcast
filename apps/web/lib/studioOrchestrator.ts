import { inferStudioAgentIntent } from "./studioAgentAsk";
import {
  isExplicitAskWhileReady,
  looksLikeManuscriptEditRequest,
  STUDIO_LENGTH_CONSTRAINT_RE,
  STUDIO_MANUSCRIPT_READ_RE,
  STUDIO_REVISE_INTENT_RE
} from "./studioReviseIntent";
import { composeTaskSentenceFromTurns, hasTaskContext } from "./studioWorkTask";
import { isDraftLikeStatus } from "./studioWorkMigrate";
import type {
  StudioAgentIntent,
  StudioAgentTurn,
  StudioRun,
  StudioWork
} from "./studioWorkTypes";

export type StudioTool = StudioRun["tool"];

export type StudioRunStatus = StudioRun["status"];

export type StudioAskContextFlags = {
  includeManuscript: boolean;
  includeMemory: boolean;
};

export type StudioRouteDecision = {
  tool: StudioTool;
  intent: StudioAgentIntent;
  /** 给用户/调试的简短说明，可展示在产物区 */
  note: string;
  askContext: StudioAskContextFlags;
};

const MAX_RUNS = 12;

const WRITE_INTENT =
  /生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇|我想创作|我想写/;

/** V2：门禁全部删除 — 仅用于 UI hint，不阻断路由 */
export function needsPromoBriefClarification(_userMessage: string): boolean {
  return false;
}

export function isInsufficientBrief(_userMessage: string): boolean {
  return false;
}

/** 纯问答（无写稿意图）时不触发自动 generate */
function isAskOnlyMessage(q: string, intent: StudioAgentIntent): boolean {
  const hasWriteIntent = WRITE_INTENT.test(q);
  if (intent === "manuscript_coach") return true;
  if (intent === "ops_strategy" && !hasWriteIntent) return true;
  if (hasWriteIntent) return false;
  if (/[?？]$/.test(q.trim())) return true;
  if (/怎么(写|改|搭)|如何(写|改)|钩子|开头|结构/.test(q)) return true;
  if (/^(帮我)?(分析|解读|看看|讲讲)/.test(q)) return true;
  return false;
}

/** 当前输入是否足以触发自动成稿（V2：open-ended 默认 generate） */
export function wouldAutoGenerate(
  work: StudioWork,
  userMessage: string,
  turns?: StudioAgentTurn[]
): boolean {
  return routeStudioAction(work, userMessage, turns).tool === "generate";
}

/**
 * V2 客户端轻量路由：最终 tool 由后端 Planner 决定；
 * 此处仅用于 ghost / legacy ask 路径。
 */
export function routeStudioAction(
  work: StudioWork,
  userMessage: string,
  turns?: StudioAgentTurn[]
): StudioRouteDecision {
  const q = userMessage.trim();
  const intent = inferStudioAgentIntent(q, work);
  const turnList = turns ?? work.agentTurns;
  const taskReady = hasTaskContext(work, turnList);

  if (work.status === "generating") {
    if (/[?？]$/.test(q) || /^(什么|为何|怎么|为什么)/.test(q)) {
      return {
        tool: "ask",
        intent,
        note: "生成中 · 将回答你的问题",
        askContext: { includeManuscript: true, includeMemory: true }
      };
    }
    return {
      tool: "ask",
      intent,
      note: "生成中 · 约束已排队",
      askContext: { includeManuscript: true, includeMemory: true }
    };
  }

  const hasMs = (work.versions?.length ?? 0) > 0;
  if ((work.status === "ready" || work.status === "shipped") && hasMs) {
    if (isExplicitAskWhileReady(q) || STUDIO_MANUSCRIPT_READ_RE.test(q)) {
      return {
        tool: "ask",
        intent,
        note: "Answering… · 问答",
        askContext: { includeManuscript: true, includeMemory: true }
      };
    }
    if (looksLikeManuscriptEditRequest(q, true)) {
      return {
        tool: "revise",
        intent: "revise_coach",
        note: "Editing… · 修改当前稿件",
        askContext: { includeManuscript: true, includeMemory: true }
      };
    }
  }

  if (
    isDraftLikeStatus(work.status) &&
    (work.versions?.length ?? 0) === 0 &&
    !isAskOnlyMessage(q, intent) &&
    (taskReady || q.length >= 1 || WRITE_INTENT.test(q) || q.length >= 4)
  ) {
    return {
      tool: "generate",
      intent,
      note: "Writing… · 开始写稿",
      askContext: { includeManuscript: false, includeMemory: false }
    };
  }

  const includeManuscript =
    intent === "manuscript_coach" ||
    intent === "revise_coach" ||
    (work.status === "ready" || work.status === "shipped");

  const corpusBound = Boolean(
    work.binding?.notebook?.trim() && (work.binding?.noteIds?.length ?? 0) > 0
  );
  const noteParts = [
    "Answering…",
    corpusBound ? "已绑资料" : "未绑资料",
    includeManuscript ? "含当前稿件" : "不含稿件全文"
  ];

  return {
    tool: "ask",
    intent,
    note: noteParts.join(" · "),
    askContext: { includeManuscript, includeMemory: true }
  };
}

export function appendStudioRun(
  work: StudioWork,
  tool: StudioTool,
  summary: string,
  status: StudioRunStatus = "running",
  extra?: Partial<Pick<StudioRun, "jobId" | "finishedAt" | "anchorTurnId">> & { runId?: string }
): { work: StudioWork; runId: string } {
  const { runId: presetRunId, ...runExtra } = extra ?? {};
  const runId = presetRunId?.trim() || crypto.randomUUID();
  const run: StudioRun = {
    id: runId,
    tool,
    status,
    summary,
    startedAt: Date.now(),
    ...runExtra
  };
  const runs = [...(work.agentRuns ?? []), run].slice(-MAX_RUNS);
  return {
    work: { ...work, agentRuns: runs, lastOrchestratorNote: summary },
    runId
  };
}

export function finishStudioRun(
  work: StudioWork,
  runId: string,
  status: Exclude<StudioRunStatus, "running">,
  summary?: string
): StudioWork {
  const runs = (work.agentRuns ?? []).map((r) =>
    r.id === runId
      ? {
          ...r,
          status,
          summary: summary ?? r.summary,
          finishedAt: Date.now()
        }
      : r
  );
  const note = summary?.trim();
  return {
    ...work,
    agentRuns: runs,
    ...(note ? { lastOrchestratorNote: note } : {})
  };
}

/** 生成/改版进行中：同步 runPhase 与轨迹文案，避免一直停在「生成稿件中…」 */
export function patchStudioGeneratePhase(
  work: StudioWork,
  runId: string | undefined,
  phase: string
): StudioWork {
  const msg = phase.trim() || "处理中…";
  const uiPhase = msg;
  const runs = runId
    ? (work.agentRuns ?? []).map((r) =>
        r.id === runId && r.status === "running" ? { ...r, summary: msg } : r
      )
    : work.agentRuns;
  return {
    ...work,
    runPhase: uiPhase,
    agentRuns: runs,
    ...(uiPhase ? { lastOrchestratorNote: uiPhase } : {})
  };
}

export function studioToolLabel(tool: StudioTool): string {
  switch (tool) {
    case "ask":
      return "对话";
    case "plan":
      return "计划";
    case "generate":
      return "成稿";
    case "revise":
      return "改版";
    default:
      return tool;
  }
}
