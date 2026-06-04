/** Studio 平台级 Rules（每次对话注入，用户不可关闭） */
export function buildStudioPlatformRulesPrompt(): string {
  return [
    "【平台 Rules】",
    "· 对话区仅解释、追问与修改方向，不输出可直接发布的完整成稿。",
    "· 生成计划、成稿、改版预览与确认操作仅在下方产物区完成，须用户确认后执行。",
    "· 不得代替产物区的「确认执行」或 Job 直接产出终稿。"
  ].join("\n");
}
