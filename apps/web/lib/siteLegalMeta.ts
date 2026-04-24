/**
 * 法律文案中的运营方与展示名。
 * 对外客服/隐私联系邮箱默认 prestoai@163.com；部署时可通过 NEXT_PUBLIC_SUPPORT_EMAIL 覆盖（与 supportLink 一致）。
 */
export const LEGAL_OPERATOR_NAME_CN = "北京抹趣文化科技有限公司";

/** 公示的客服与隐私联系邮箱（可被环境变量覆盖） */
export const LEGAL_DEFAULT_CONTACT_EMAIL = "prestoai@163.com";

/** 账号注销完成后，除依法须留存的信息外，删除或匿名化个人信息的承诺期限（自然日） */
export const LEGAL_ACCOUNT_DELETE_GRACE_DAYS = 7;

/** 与 layout metadata、NEXT_PUBLIC_APP_NAME 保持一致时的展示名 */
export function getSiteProductDisplayName(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_NAME || "").trim();
  return raw || "Presto";
}

export function getLegalContactEmail(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
  return fromEnv || LEGAL_DEFAULT_CONTACT_EMAIL;
}
