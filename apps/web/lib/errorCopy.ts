/**
 * 区分「用户可修正」与「系统侧异常」，用于全局错误页的文案分层。
 */
export type ErrorTone = "user" | "system";

const USER_PATTERNS =
  /额度|配额|429|频率|验证|格式|参数|400|401|403|未授权|登录|密码|过大|超长|invalid|forbidden|unauthorized/i;
const SYSTEM_PATTERNS =
  /digest|chunk|hydration|服务端|server|5\d\d|502|503|504|timeout|timed out|network|econn|fetch failed|failed to fetch|unexpected/i;

export function classifyErrorTone(message: string | undefined | null): ErrorTone {
  const m = String(message || "");
  if (USER_PATTERNS.test(m)) return "user";
  if (SYSTEM_PATTERNS.test(m)) return "system";
  if (m.length > 180) return "system";
  return "user";
}

export function errorPageCopy(tone: ErrorTone, t: (key: string) => string): { headline: string; sub: string } {
  const prefix = tone === "system" ? "error.system" : "error.user";
  return {
    headline: t(`${prefix}.headline`),
    sub: t(`${prefix}.sub`)
  };
}
