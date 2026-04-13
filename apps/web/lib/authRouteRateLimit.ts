import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };

function createWindowLimiter(maxPerWindow: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return function allow(key: string): boolean {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count >= maxPerWindow) return false;
    b.count += 1;
    return true;
  };
}

/** 与历史 login 路由一致：每 IP 每 60s 最多 30 次登录尝试 */
export const allowLoginPerIp = createWindowLimiter(30, 60_000);

/** BFF 第一道闸：每 IP 每 60s 发码请求（编排器侧另有 Redis/内存限流） */
export const allowRegisterSendCodePerIp = createWindowLimiter(20, 60_000);

/** 忘记密码发信：防刷邮箱 */
export const allowForgotPasswordPerIp = createWindowLimiter(8, 60_000);

export function clientIpFromNextRequest(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
