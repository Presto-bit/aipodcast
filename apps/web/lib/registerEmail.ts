/**
 * 与编排器 auth_service.EMAIL_RE 一致：`[^@\s]+@[^@\s]+\.[^@\s]+`（前后无空白）。
 * 用于注册发码前本地校验，减少无效请求。
 */
export const REGISTER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const MAX_EMAIL_LEN = 160;

export function isRegisterEmailFormatOk(email: string): boolean {
  const e = email.trim();
  if (!e || e.length > MAX_EMAIL_LEN) return false;
  if (/\s/.test(e)) return false;
  return REGISTER_EMAIL_PATTERN.test(e);
}
