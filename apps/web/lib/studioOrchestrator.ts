import { inferStudioAgentIntent } from "./studioAgentAsk";
import { hasTaskContext } from "./studioWorkTask";
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

/** 纯问答（无写稿意图）时不触发自动 generate */
function isAskOnlyMessage(q: string, intent: StudioAgentIntent): boolean {
  const hasWriteIntent = /生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇/.test(q);
  if (intent === "manuscript_coach") return true;
  if (intent === "ops_strategy" && !hasWriteIntent) return true;
  if (hasWriteIntent) return false;
  if (/[?？]$/.test(q.trim())) return true;
  if (/怎么(写|改|搭)|如何(写|改)|钩子|开头|结构/.test(q)) return true;
  if (/^(帮我)?(分析|解读|看看|讲讲)/.test(q)) return true;
  return false;
}

/** 主编排：决定走对话(ask) 还是子任务工具(generate/revise) */
export function routeStudioAction(
  work: StudioWork,
  userMessage: string,
  turns?: StudioAgentTurn[]
): StudioRouteDecision {
  const q = userMessage.trim();
  const intent = inferStudioAgentIntent(q, work);
  const taskReady = hasTaskContext(work, turns ?? work.agentTurns);

  if (work.status === "generating") {
    return {
      tool: "ask",
      intent,
      note: "生成进行中，仅回答进度与解读类问题",
      askContext: { includeManuscript: true, includeMemory: true }
    };
  }

  if (
    (work.status === "ready" || work.status === "shipped") &&
    work.versions.length > 0 &&
    /改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改/.test(q)
  ) {
    return {
      tool: "revise",
      intent: "revise_coach",
      note: "将按输入执行改版",
      askContext: { includeManuscript: true, includeMemory: true }
    };
  }

  if (
    isDraftLikeStatus(work.status) &&
    taskReady &&
    work.versions.length === 0 &&
    !isAskOnlyMessage(q, intent)
  ) {
    return {
      tool: "generate",
      intent,
      note: "开始生成稿件",
      askContext: { includeManuscript: false, includeMemory: false }
    };
  }

  const includeManuscript =
    intent === "manuscript_coach" ||
    intent === "revise_coach" ||
    (work.status === "ready" || work.status === "shipped");

  const corpusBound = Boolean(work.binding.notebook.trim() && work.binding.noteIds.length > 0);
  const noteParts = [
    "对话解释",
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
  extra?: Partial<Pick<StudioRun, "jobId" | "finishedAt">>
): { work: StudioWork; runId: string } {
  const runId = crypto.randomUUID();
  const run: StudioRun = {
    id: runId,
    tool,
    status,
    summary,
    startedAt: Date.now(),
    ...extra
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
  const runs = runId
    ? (work.agentRuns ?? []).map((r) =>
        r.id === runId && r.status === "running" ? { ...r, summary: msg } : r
      )
    : work.agentRuns;
  return { ...work, runPhase: msg, agentRuns: runs, lastOrchestratorNote: msg };
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
