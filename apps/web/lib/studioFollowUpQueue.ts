import type { FollowUpItem, StudioWork } from "./studioWorkTypes";

export function appendFollowUp(work: StudioWork, text: string): StudioWork {
  const q = text.trim();
  if (!q) return work;
  const item: FollowUpItem = {
    id: crypto.randomUUID(),
    text: q,
    createdAt: Date.now()
  };
  return { ...work, followUps: [...(work.followUps ?? []), item] };
}

export function followUpCount(work: StudioWork): number {
  return work.followUps?.length ?? 0;
}

export function followUpHint(work: StudioWork): string | null {
  const n = followUpCount(work);
  if (n <= 0) return null;
  const last = work.followUps!.at(-1)!;
  const preview = last.text.length > 24 ? `${last.text.slice(0, 24)}…` : last.text;
  return `排队 ${n} 条：${preview}`;
}

/** 取出并清空 follow-up，返回合并文本供下一轮 brief */
export function drainFollowUps(work: StudioWork): { work: StudioWork; texts: string[] } {
  const texts = (work.followUps ?? []).map((f) => f.text.trim()).filter(Boolean);
  return { work: { ...work, followUps: [] }, texts };
}
