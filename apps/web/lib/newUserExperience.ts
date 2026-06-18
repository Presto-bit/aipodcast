/**
 * 新用户一次性体验包额度（与编排器 subscription_manifest 一致）。
 * 营销页 / 注册页展示用；运行时余额以 /api/subscription/me 为准。
 */
export const NEW_USER_EXPERIENCE = {
  voiceMinutes: 20,
  asrMinutes: 20,
  textChars: 10_000
} as const;

/** 注册页 / 营销页一行说明 */
export function newUserExperienceTagline(): string {
  const { voiceMinutes, asrMinutes, textChars } = NEW_USER_EXPERIENCE;
  const textK = textChars >= 1000 ? `${Math.round(textChars / 1000)}k` : String(textChars);
  return `注册即送 ${voiceMinutes} 分钟语音、${asrMinutes} 分钟转写与 ${textK} 字文稿体验额度`;
}

/** 注册页：30 秒能做什么 */
export function registerQuickStartLine(): string {
  return "约 30 秒：选模板试听 → 注册 → 上传资料生成自己的播客";
}
