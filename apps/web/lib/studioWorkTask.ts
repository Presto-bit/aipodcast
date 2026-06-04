import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

/** 未开始计划/成稿的空任务（全局只允许一个） */
export function isStudioWorkDraft(work: StudioWork): boolean {
  return work.status === "briefing" && !work.plan && work.versions.length === 0;
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

export function hasTaskContext(work: StudioWork, turns?: StudioAgentTurn[]): boolean {
  return Boolean(taskSentenceFromWork({ ...work, agentTurns: turns ?? work.agentTurns }).trim());
}

/** 用首条用户消息更新任务标题 */
export function syncWorkTitleFromTurns(work: StudioWork, turns: StudioAgentTurn[]): StudioWork {
  const first = turns
    .filter((t) => t.role === "user" && !t.streaming)
    .map((t) => t.content.trim())
    .find(Boolean);
  if (!first) return work;
  const title = first.slice(0, 48);
  if (title === work.title) return work;
  return { ...work, title };
}
