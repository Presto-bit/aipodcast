/** 将 Job 原始进度映射为 Studio UI 可读文案；仅隐藏「排队」类噪音 */
export function normalizeStudioRunPhase(phase: string): string | undefined {
  const p = phase.trim();
  if (!p) return undefined;
  if (/排队|队列|云端排队/.test(p)) return undefined;
  if (/模板|重写|优化文稿/.test(p)) return "优化文稿…";
  if (/标题|钩子|条数|备选|锚点|润色/.test(p)) return "润色细节…";
  if (/检索|资料|准备创作/.test(p)) return "检索资料…";
  if (/傻瓜包|内容成品|撰写|生成内容/.test(p)) return "撰写正文…";
  if (/就绪|完成|100/.test(p)) return "即将完成…";
  if (/改版/.test(p)) return "改版中…";
  if (/写稿|处理中/.test(p)) return "写稿中…";
  return "写稿中…";
}
