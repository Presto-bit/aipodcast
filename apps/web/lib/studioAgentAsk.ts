import type { NotesAskMemoryTurn } from "./notesAskMemoryTypes";
import {
  buildStudioLayeredRulesPrompt,
  buildStudioWorkMemoryPrompt,
  corpusBindingLine,
  manuscriptVersionToPrompt
} from "./studioAgentContext";
import type { StudioAskContextFlags } from "./studioOrchestrator";
import type { ManuscriptVersion, StudioAgentIntent, StudioAgentTurn, StudioWork } from "./studioWorkTypes";
import { hasTaskContext, taskSentenceFromWork } from "./studioWorkTask";

export type { StudioAgentIntent };

const INTENT_LABEL: Record<StudioAgentIntent, string> = {
  brief_clarify: "需求澄清",
  ops_strategy: "运营策略",
  manuscript_coach: "稿件解读",
  revise_coach: "改版建议",
  general: "创作助手"
};

export function studioAgentIntentLabel(intent: StudioAgentIntent): string {
  return INTENT_LABEL[intent];
}

export function inferStudioAgentIntent(message: string, work: StudioWork): StudioAgentIntent {
  const text = message.trim();
  if (!text) return "general";

  if (
    /运营|策略|涨粉|流量|算法|投放|转化|变现|引流|起号|养号|爆款|冷启动|人设定位|栏目|日更|排期|首评|互动|矩阵|对标|复盘数据|小眼睛|收藏率/.test(
      text
    )
  ) {
    return "ops_strategy";
  }

  if (
    (work.status === "ready" || work.status === "shipped") &&
    /改版|改一下|改标题|改正文|缩短|加长|语气|更犀利|别动正文|只改/.test(text)
  ) {
    return "revise_coach";
  }

  if (work.status === "ready" || work.status === "shipped") {
    return "manuscript_coach";
  }

  if (/写成|笔记|标题|正文|受众|语气|清单|钩子|大纲|写什么/.test(text)) {
    return "brief_clarify";
  }

  return work.plan ? "manuscript_coach" : "brief_clarify";
}

export function studioTurnsToMemoryTurns(turns: StudioAgentTurn[]): NotesAskMemoryTurn[] {
  const out: NotesAskMemoryTurn[] = [];
  for (const turn of turns) {
    const text = turn.content.trim();
    if (!text || turn.streaming) continue;
    out.push({
      id: turn.id,
      role: turn.role,
      content: text
    });
  }
  return out;
}

function intentSystemPrompt(intent: StudioAgentIntent, work: StudioWork): string {
  switch (intent) {
    case "ops_strategy":
      return [
        "你是内容运营策略顾问，按用户提出的渠道与目标作答（勿默认假定平台）。",
        "用户问运营、增长、发布节奏、互动、数据复盘、起号、对标时：给出可执行、分点的建议。",
        "禁止推脱；不要代替「确认执行」产出完整成稿；需成稿时提示回复「确认任务」。"
      ].join("\n");
    case "brief_clarify":
      return [
        "你帮助澄清用户想创作的内容（形式、受众、结构、语气、资料怎么用）。",
        "用简短追问收敛；任务清楚后请用户回复「确认任务」。",
        "不要输出可直接发布的完整成稿。"
      ].join("\n");
    case "manuscript_coach":
      return [
        "你解读【当前稿件】：结构、语气、与资料/我的特色是否一致、发布注意点。",
        "引用稿件中的具体句子说明，不要重复粘贴全文（全文已在上下文）。",
        work.status === "ready" || work.status === "shipped"
          ? "成稿后：可简短追问或建议下一步（如微调标题）；勿要求再次确认执行或生成计划。"
          : ""
      ]
        .filter(Boolean)
        .join("\n");
    case "revise_coach":
      return [
        "根据用户改版意见与【当前稿件】，说明建议改哪些块（标题/正文/话题）及方向。",
        "若需实际改稿，提示用户在下方输入框直接说改版要求（将自动执行）。"
      ].join("\n");
    default:
      return [
        "你是写作 Studio 创作助手，围绕本 Work 的用户任务作答。",
        "涉及成稿：提示「确认任务」→ 输出区「确认执行」。"
      ].join("\n");
  }
}

const ASK_QUESTION_MAX = 800;
const ASK_DIALOGUE_STYLE_MAX = 4000;
const ASK_AUTHOR_IP_MAX = 8000;

/** 注入 BFF 的 Studio 上下文（禁止放入 question，避免超过 800 字校验） */
export function buildStudioAskContext(
  work: StudioWork,
  intent: StudioAgentIntent,
  activeVersion?: ManuscriptVersion | null,
  askFlags?: StudioAskContextFlags
): string {
  const task = taskSentenceFromWork(work);
  const flags = askFlags ?? { includeManuscript: false, includeMemory: true };
  const manuscript =
    flags.includeManuscript ? manuscriptVersionToPrompt(activeVersion ?? null) : "";

  const lines = [
    intentSystemPrompt(intent, work),
    buildStudioLayeredRulesPrompt(work),
    flags.includeMemory ? buildStudioWorkMemoryPrompt(work) : "",
    `【当前意图】${studioAgentIntentLabel(intent)}`,
    `任务状态：${work.status}`,
    task ? `任务要点：${task}` : "任务：用户尚未描述清楚",
    corpusBindingLine(work),
    work.plan?.goal ? `计划目标：${work.plan.goal}` : "",
    manuscript
  ].filter(Boolean);

  return lines.join("\n\n");
}

export function buildStudioAskPayload(params: {
  work: StudioWork;
  userMessage: string;
  intent: StudioAgentIntent;
  activeVersion?: ManuscriptVersion | null;
  authorIpExtra?: string;
  askFlags?: StudioAskContextFlags;
  mode: "general" | "rag";
}): {
  question: string;
  dialogueStylePrompt?: string;
  authorIpPrompt?: string;
} {
  const q = params.userMessage.trim().slice(0, ASK_QUESTION_MAX);
  const ctx = buildStudioAskContext(
    params.work,
    params.intent,
    params.activeVersion,
    params.askFlags
  );
  const merged = [ctx, params.authorIpExtra?.trim()].filter(Boolean).join("\n\n");

  if (params.mode === "rag") {
    return {
      question: q,
      dialogueStylePrompt: merged.slice(0, ASK_DIALOGUE_STYLE_MAX) || undefined
    };
  }
  return {
    question: q,
    authorIpPrompt: merged.slice(0, ASK_AUTHOR_IP_MAX) || undefined
  };
}

/** @deprecated 仅测试；线上请用 buildStudioAskPayload */
export function buildStudioAgentQuestion(
  work: StudioWork,
  userMessage: string,
  intent: StudioAgentIntent,
  activeVersion?: ManuscriptVersion | null
): string {
  return `${buildStudioAskContext(work, intent, activeVersion, { includeManuscript: true, includeMemory: true })}\n\n---\n用户：\n${userMessage.trim()}`;
}

export { hasTaskContext, taskSentenceFromWork };
