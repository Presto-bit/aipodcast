import { featureCoreToPrompt, isFeatureCoreComplete } from "./homeComposerFeatureCore";
import type { NotesAskMemoryTurn } from "./notesAskMemoryTypes";
import { studioVoiceAgentInstructions } from "./studioVoiceFromChat";
import type { StudioAgentIntent, StudioAgentTurn, StudioWork } from "./studioWorkTypes";

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

  if (/写成|笔记|标题|正文|受众|语气|清单|钩子|大纲|Brief|写什么/.test(text)) {
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
        "用户问运营、增长、发布节奏、互动、数据复盘、起号、对标时：给出可执行、分点的建议，并结合下方任务记录/资料/Voice。",
        "禁止回复「我无法做运营策略/不能回答运营」等推脱；这是你的主职责之一。",
        "不要代替「确认执行」产出完整成稿；若用户要成稿，提示先收敛任务后回复「确认任务」。",
        isFeatureCoreComplete(work.featureCore) ? "" : studioVoiceAgentInstructions(work)
      ]
        .filter(Boolean)
        .join("\n");
    case "brief_clarify":
      return [
        "你帮助澄清用户想创作的内容（形式、受众、结构、语气、资料怎么用）；需求由用户提出，勿替用户选定渠道或体裁。",
        "用简短追问收敛任务；对话会自动记录，无需用户填表；任务清楚后请用户回复「确认任务」以进入执行确认。",
        "不要输出可直接发布的完整成稿。",
        studioVoiceAgentInstructions(work)
      ].join("\n");
    case "manuscript_coach":
      return [
        "你解读当前稿件版本：结构是否合理、与资料/Voice 是否一致、发布注意点。",
        "不要无故拒绝；仅当问题超出创作/运营范畴（如实时私密数据、违法）时简短说明限制。"
      ].join("\n");
    case "revise_coach":
      return [
        "你根据用户改版意见，说明建议改哪些块（标题/正文/话题），并给出可粘贴的修改方向。",
        "若需执行 Job 改版，提示在稿件区「改版」输入框提交，或收敛进 Brief 后重新生成。"
      ].join("\n");
    default:
      return [
        "你是写作 Studio 创作助手，围绕本 Work 的用户任务作答（渠道与体裁以用户描述为准）。",
        "尽力作答；不要默认拒绝。仅在大模型/平台确实无法做到时（如未授权实时数据、违法内容）简短说明。",
        "涉及成稿生成时提醒：任务清楚后请用户回复「确认任务」，再在输出区「确认执行」。",
        studioVoiceAgentInstructions(work)
      ].join("\n");
  }
}

function voiceStatusLine(work: StudioWork): string {
  const instr = studioVoiceAgentInstructions(work);
  if (instr.startsWith("Voice（我的特色）三项已在")) return instr.split("；")[0]!;
  return instr.split("\n")[0]!;
}

export function buildStudioAgentQuestion(
  work: StudioWork,
  userMessage: string,
  intent: StudioAgentIntent
): string {
  const lines = [
    intentSystemPrompt(intent, work),
    `【当前意图】${studioAgentIntentLabel(intent)}`,
    `任务状态：${work.status}`,
    work.brief.trim() ? `Brief（对话已记录）：${work.brief.trim()}` : "Brief：尚未从对话收敛",
    work.binding.notebook
      ? `资料：${work.binding.notebook} · ${work.binding.noteIds.length} 篇`
      : "资料：未绑定",
    work.allowModelFallback ? "允许通识兜底：是" : "允许通识兜底：否",
    work.plan?.goal ? `计划目标：${work.plan.goal}` : "",
    voiceStatusLine(work),
    featureCoreToPrompt(work.featureCore) ? `已记录 Voice：\n${featureCoreToPrompt(work.featureCore)}` : ""
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n---\n用户：\n${userMessage.trim()}`;
}

/** 从对话收敛 Brief（自动同步，不在表单展示） */
export function suggestBriefFromTurns(work: StudioWork, turns: StudioAgentTurn[]): string {
  const texts = turns
    .filter((t) => !t.streaming && t.content.trim())
    .map((t) => t.content)
    .join("\n");
  const briefLine = texts.match(/Brief[：:]\s*([^\n]+)/i);
  if (briefLine?.[1]) return briefLine[1].trim().slice(0, 800);

  const users = turns
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .filter(Boolean);
  if (users.length) return users.join("；").slice(0, 800);

  return work.brief.trim();
}

export function mergeBriefIntoWork(work: StudioWork, turns: StudioAgentTurn[]): StudioWork | null {
  const draft = suggestBriefFromTurns(work, turns).trim();
  if (!draft || draft === work.brief.trim()) return null;
  return {
    ...work,
    brief: draft,
    title: draft.slice(0, 48) || work.title,
    status: work.status === "shipped" ? work.status : work.status === "ready" ? work.status : "briefing"
  };
}
