/**
 * 法律文案中的运营方与展示名；联系邮箱优先复用客服环境变量。
 * 部署时请在环境变量中配置 NEXT_PUBLIC_SUPPORT_EMAIL（与 supportLink 一致）。
 */
export const LEGAL_OPERATOR_NAME_CN = "北京抹趣文化科技有限公司";

/** 与 layout metadata、NEXT_PUBLIC_APP_NAME 保持一致时的展示名 */
export function getSiteProductDisplayName(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_NAME || "").trim();
  return raw || "Presto";
}

export function getLegalContactEmail(): string {
  return (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
}
