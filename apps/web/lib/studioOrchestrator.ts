import { inferStudioAgentIntent } from "./studioAgentAsk";
import { normalizeStudioRunPhase } from "./studioRunPhase";
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

const TOPIC_FORM_SIGNAL =
  /清单|小红书|笔记|教程|测评|好物|干货|故事|攻略|标题|正文|受众|新人|职场|产品|运营|清单体|种草|周报|总结/;

const PROMO_DETAIL_SIGNAL =
  /受众|人群|读者|卖点|场景|功能|材质|主打|痛点|提醒|便携|保温|职场|新人|白领|品牌|价格|差异化|清单体|教程|测评|故事/;

/** 推广/种草句仅有品类名、缺受众或卖点时先走 ask 确认需求 */
export function needsPromoBriefClarification(userMessage: string): boolean {
  const text = userMessage.trim();
  const isPromoTask =
    /推广|种草|带货/.test(text) ||
    (/水杯|杯子|保温杯|产品|新品/.test(text) && /小红书|笔记|写篇|写一篇/.test(text));
  if (!isPromoTask) return false;
  return !PROMO_DETAIL_SIGNAL.test(text);
}

/** 需求过短/过模糊时不自动成稿，改走 ask 澄清 */
export function isInsufficientBrief(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return true;
  if (text.length < 8) return true;
  if (needsPromoBriefClarification(text)) return true;
  const hasWriteIntent = /生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇/.test(text);
  const hasTopicOrForm = TOPIC_FORM_SIGNAL.test(text);
  if (hasWriteIntent && hasTopicOrForm) return false;
  if (hasWriteIntent && text.length >= 14) return false;
  if (hasTopicOrForm && text.length >= 12) return false;
  if (/^(帮我想|写点|想做|来点|整点|搞个|随便)/.test(text) && !hasTopicOrForm) return true;
  return text.length < 14 && !hasTopicOrForm && !hasWriteIntent;
}

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

/** 当前输入是否足以触发自动成稿（与 routeStudioAction 同源） */
export function wouldAutoGenerate(
  work: StudioWork,
  userMessage: string,
  turns?: StudioAgentTurn[]
): boolean {
  return routeStudioAction(work, userMessage, turns).tool === "generate";
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
    (work.versions?.length ?? 0) > 0 &&
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
    (work.versions?.length ?? 0) === 0 &&
    !isAskOnlyMessage(q, intent) &&
    !isInsufficientBrief(q)
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

  const corpusBound = Boolean(
    work.binding?.notebook?.trim() && (work.binding?.noteIds?.length ?? 0) > 0
  );
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
  extra?: Partial<Pick<StudioRun, "jobId" | "finishedAt" | "anchorTurnId">>
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
  const uiPhase = normalizeStudioRunPhase(msg);
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
