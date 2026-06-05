/** Studio UI 不展示队列/检索等 Job 进度文案 */
export function normalizeStudioRunPhase(phase: string): string | undefined {
  const p = phase.trim();
  if (!p) return undefined;
  if (/排队|队列|云端|检索|资料|傻瓜包|准备创作|撰写|生成内容|处理中/.test(p)) {
    return undefined;
  }
  return undefined;
}
