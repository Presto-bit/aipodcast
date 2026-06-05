/** 用户确认开始写稿（放宽整句匹配，避免「好的，确认任务」无法触发） */
export function isConfirmPlanMessage(message: string): boolean {
  const q = message.trim();
  if (!q) return false;
  if (
    /^(确认任务|确认范围|确认|就按这个|就这样|可以了|开始写|开始生成|生成计划|开写|写吧)[。！!？?\s]*$/u.test(
      q
    )
  ) {
    return true;
  }
  if (q.length <= 48 && /(确认任务|确认范围|就按这个|可以开始|开始写稿)/.test(q)) {
    return true;
  }
  return false;
}
