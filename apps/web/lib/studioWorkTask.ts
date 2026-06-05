import { isDraftLikeStatus } from "./studioWorkMigrate";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";
import { fallbackStudioWorkTitle } from "./studioWorkTitleSuggest";

/** 未成稿的空任务（全局只允许一个） */
export function isStudioWorkDraft(work: StudioWork): boolean {
  return isDraftLikeStatus(work.status) && work.versions.length === 0;
}

/** 从对话用户消息拼任务句（不再维护会话 Brief 字段） */
export function taskSentenceFromWork(work: StudioWork): string {
  const users = (work.agentTurns ?? [])
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .filter(Boolean);
  if (users.length) return users.join("\n\n").slice(0, 2000);
  return work.brief.trim();
}

/** 纯问答轮次（无写稿意图），成稿时应剔除，避免污染任务句 */
export function isAskOnlyUserTurn(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (/生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇|我想创作/.test(q)) return false;
  if (/[?？]$/.test(q)) return true;
  if (/怎么(写|改|搭)|如何(写|改)|钩子|开头|结构/.test(q)) return true;
  if (/^(帮我)?(分析|解读|看看|讲讲)/.test(q)) return true;
  if (/运营|策略|涨粉|流量|算法/.test(q)) return true;
  return false;
}

/** 成稿/改版前的任务句：去掉纯问答轮，保留真实创作 brief */
export function composeTaskSentenceFromTurns(
  turns: StudioAgentTurn[],
  currentMessage = ""
): string {
  const parts: string[] = [];
  for (const t of turns) {
    if (t.role !== "user" || t.streaming) continue;
    const text = t.content.trim();
    if (text && !isAskOnlyUserTurn(text)) parts.push(text);
  }
  const cur = currentMessage.trim();
  if (cur && !isAskOnlyUserTurn(cur)) {
    if (!parts.length || parts[parts.length - 1] !== cur) parts.push(cur);
  }
  if (parts.length) return parts.join("\n\n").slice(0, 2000);
  if (cur) return cur.slice(0, 2000);
  return turns
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
}

export function hasTaskContext(work: StudioWork, turns?: StudioAgentTurn[]): boolean {
  return Boolean(taskSentenceFromWork({ ...work, agentTurns: turns ?? work.agentTurns }).trim());
}

/** 用首条用户消息更新任务标题（同步 fallback；LLM 标题由 Dock 异步覆盖） */
export function syncWorkTitleFromTurns(work: StudioWork, turns: StudioAgentTurn[]): StudioWork {
  const first = turns
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .find(Boolean);
  if (!first) return work;
  if (work.titleLlmSource === first) return work;
  const title = fallbackStudioWorkTitle(first);
  if (title === work.title && !work.titleLlmSource) return work;
  return { ...work, title, titleLlmSource: undefined };
}

export function firstUserSentenceFromTurns(turns: StudioAgentTurn[]): string {
  return (
    turns
      .filter((t) => t.role === "user" && !t.streaming)
      .map((t) => t.content.trim())
      .find(Boolean) ?? ""
  );
}
