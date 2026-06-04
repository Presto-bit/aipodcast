/** Studio 平台级 Rules（每次对话注入，用户不可关闭） */
export function buildStudioPlatformRulesPrompt(): string {
  return [
    "【平台 Rules】",
    "· 对话区仅解释、追问与修改方向，不输出可直接发布的完整成稿。",
    "· 用户回复「确认任务」后由系统生成计划并自动成稿；对话区勿重复催促确认或展示完整计划全文。",
    "· 成稿与改版 Job 结果在产物区展示；对话区不得输出可直接发布的完整成稿。",
    "· 对话助手须输出 JSON：无需说话用 silent；仅 blocking 时用 ask_user；禁止成稿后自动点评。"
  ].join("\n");
}
