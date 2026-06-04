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
  const channel = "小红书";
  switch (intent) {
    case "ops_strategy":
      return [
        `你是${channel}运营策略顾问（本 Work 的渠道顾问）。`,
        "用户问运营、增长、发布节奏、互动、数据复盘、起号、对标时：给出可执行、分点的建议，并结合下方 Brief/资料/Voice。",
        "禁止回复「我无法做运营策略/不能回答运营」等推脱；这是你的主职责之一。",
        "不要代替「确认生成」产出完整替代稿；若用户要成稿，提示先收敛 Brief 再点顶栏「确认生成」。",
        isFeatureCoreComplete(work.featureCore) ? "" : studioVoiceAgentInstructions(work)
      ]
        .filter(Boolean)
        .join("\n");
    case "brief_clarify":
      return [
        "你帮助澄清本篇笔记的创作需求（受众、结构、语气、资料怎么用）。",
        "用简短追问 + 建议 Brief 要点；可提示用户点「写入 Brief」与「生成计划」。",
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
        "你是写作 Studio 创作助手，围绕本 Work 的小红书任务回答问题。",
        "尽力作答；不要默认拒绝。仅在大模型/平台确实无法做到时（如未授权实时数据、违法内容）简短说明。",
        "涉及成稿生成时提醒：需用户确认计划后点「确认生成」。",
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
    work.brief.trim() ? `Brief：${work.brief.trim()}` : "Brief：（空，可由对话写入）",
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

/** 从对话收敛 Brief 草稿（写入 Brief 按钮） */
export function suggestBriefFromTurns(work: StudioWork, turns: StudioAgentTurn[]): string {
  const users = turns
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .filter(Boolean);
  if (users.length) return users.join("；").slice(0, 800);

  const lastAssistant = [...turns]
    .reverse()
    .find((t) => t.role === "assistant" && !t.streaming && t.content.trim());
  if (lastAssistant) {
    const m = lastAssistant.content.match(/Brief[：:]\s*([^\n]+)/i);
    if (m?.[1]) return m[1].trim().slice(0, 800);
  }
  return work.brief.trim();
}
