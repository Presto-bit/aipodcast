import { NextRequest, NextResponse } from "next/server";

/** 进程内限流：多副本 / Serverless 横向扩展时无法全局共享，滥用面可被多 IP 稀释；生产建议在网关或 Redis 侧叠加配额。 */
const inMemoryWindow = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
/** 全站 /api 粗粒度防护；笔记区一次上传会叠加大量列表/作品请求，120 容易误伤 */
const LIMIT = 400;

/** 单用户低频、大包体：不应占用与其它 /api 共用的每分钟计数（也避免拿不到 IP 时全退化为 "unknown" 顶满上限） */
const RATE_LIMIT_EXEMPT_POST_PATHS = new Set([
  "/api/note-upload",
  "/api/notes/upload",
  "/api/notes/import_url"
]);

function clientRateLimitKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  if (req.ip) return req.ip;
  return "unknown";
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const row = inMemoryWindow.get(key);
  if (!row || row.resetAt < now) {
    inMemoryWindow.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (row.count >= LIMIT) return false;
  row.count += 1;
  inMemoryWindow.set(key, row);
  return true;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Cookie, X-Internal-Signature, X-Internal-Timestamp, X-Internal-Payload-Sha256"
      }
    });
  }
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  /** 由路由内 `/api/image-proxy` 单独按 IP 限速，避免拖满全站 400/min */
  if (pathname === "/api/image-proxy" && req.method === "GET") {
    return NextResponse.next();
  }
  if (req.method === "POST" && RATE_LIMIT_EXEMPT_POST_PATHS.has(pathname)) {
    return NextResponse.next();
  }
  const clientKey = clientRateLimitKey(req);
  if (!checkRateLimit(clientKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"]
};
