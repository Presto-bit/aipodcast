import { featureCoreToPrompt } from "./homeComposerFeatureCore";
import type { NotesAskMemoryTurn } from "./notesAskMemoryTypes";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

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

export function buildStudioAgentQuestion(work: StudioWork, userMessage: string): string {
  const lines = [
    "你是「写作 Studio」底部 Agent，帮助用户澄清小红书笔记创作需求（受众、结构、语气、资料怎么用）。",
    "不要输出完整可发布的成稿；可给 Brief 建议与下一步操作（写入 Brief → 生成计划 → 用户确认后再生成）。",
    `任务状态：${work.status}`,
    work.brief.trim() ? `当前 Brief：${work.brief.trim()}` : "当前 Brief：（空）",
    work.binding.notebook
      ? `已绑定资料：笔记本「${work.binding.notebook}」· ${work.binding.noteIds.length} 篇`
      : "资料：未绑定笔记本",
    work.allowModelFallback ? "已允许通识兜底" : "未勾选通识兜底",
    work.plan?.goal ? `已有计划目标：${work.plan.goal}` : "",
    featureCoreToPrompt(work.featureCore) ? `Voice：\n${featureCoreToPrompt(work.featureCore)}` : ""
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n---\n用户消息：\n${userMessage.trim()}`;
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
