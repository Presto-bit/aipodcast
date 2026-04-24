import { NextRequest, NextResponse } from "next/server";
import { sensitiveApiPath, sensitiveDocumentPath } from "./lib/sensitiveCacheRoutes";

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

/** 页面与 RSC：禁止浏览器与遵守源站的 CDN 长期缓存 HTML（与 layout force-dynamic 叠加） */
const CACHE_PAGE = "private, no-cache, no-store, max-age=0, must-revalidate";
/** BFF / API：不进入共享边缘长期缓存 */
const CACHE_API = "no-store, max-age=0, must-revalidate";
/** 浏览器私有短缓存：仅用于匿名/弱个性化只读 GET，减轻重复请求（`private` 不供 CDN 共享） */
const CACHE_API_PRIVATE_SHORT = "private, max-age=45, stale-while-revalidate=180";

function withCacheHeaders(res: NextResponse, directive: string): NextResponse {
  res.headers.set("Cache-Control", directive);
  res.headers.set("Pragma", "no-cache");
  return res;
}

function withPrivateShortCache(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", CACHE_API_PRIVATE_SHORT);
  return res;
}

/**
 * 敏感业务：强制 CDN/代理按 Cookie（及 API 的 Authorization）区分缓存键，避免「同 URL 多用户」命中共享对象。
 * 与 Next 默认 RSC Vary 合并为单头，减少重复 Vary。
 */
function applySensitiveSharedCacheVary(res: NextResponse, kind: "page" | "api"): NextResponse {
  const base =
    kind === "page"
      ? ["RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Accept-Encoding", "Cookie"]
      : ["Cookie", "Authorization", "Accept-Encoding"];
  res.headers.set("Vary", base.join(", "));
  return res;
}

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

/** 浏览器在 www（CDN）而 BFF 直连源站子域时，须配置白名单 Origin，见 NEXT_PUBLIC_NOTES_ASK_CORS_ORIGINS */
const NOTES_ASK_API_PREFIX = "/api/notes/ask";

function notesAskCorsAllowedOrigins(): string[] {
  const raw = (process.env.NEXT_PUBLIC_NOTES_ASK_CORS_ORIGINS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function applyNotesAskApiCors(req: NextRequest, res: NextResponse): NextResponse {
  const p = req.nextUrl.pathname;
  if (!p.startsWith(NOTES_ASK_API_PREFIX)) return res;
  const allowed = notesAskCorsAllowedOrigins();
  if (!allowed.length) return res;
  const origin = req.headers.get("origin")?.trim();
  if (!origin || !allowed.includes(origin)) return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Expose-Headers", "x-request-id");
  return res;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image")) {
    return NextResponse.next();
  }

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const opt = withCacheHeaders(
      new NextResponse(null, {
        status: 204,
        headers: {
          Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Cookie, X-Request-ID, X-Internal-Signature, X-Internal-Timestamp, X-Internal-Payload-Sha256"
        }
      }),
      CACHE_API
    );
    if (sensitiveApiPath(pathname)) applySensitiveSharedCacheVary(opt, "api");
    return applyNotesAskApiCors(req, opt);
  }

  if (!pathname.startsWith("/api/")) {
    const res = withCacheHeaders(NextResponse.next(), CACHE_PAGE);
    if (sensitiveDocumentPath(pathname)) {
      applySensitiveSharedCacheVary(res, "page");
    }
    return res;
  }

  /** 支付宝异步通知：路由内另有单列限流，避免与其它 /api 共用 400/min 误伤重试 */
  if (pathname === "/api/webhooks/alipay" && req.method === "POST") {
    return applyNotesAskApiCors(req, withCacheHeaders(NextResponse.next(), CACHE_API));
  }
  /** 由路由内 `/api/image-proxy` 单独按 IP 限速，避免拖满全站 400/min */
  if (pathname === "/api/image-proxy" && req.method === "GET") {
    return applyNotesAskApiCors(req, withCacheHeaders(NextResponse.next(), CACHE_API));
  }
  /** 系统默认音色目录：匿名可读，浏览器可短期复用响应 */
  if (
    req.method === "GET" &&
    (pathname === "/api/default-voices" || pathname.startsWith("/api/default-voices/"))
  ) {
    return applyNotesAskApiCors(req, withPrivateShortCache(NextResponse.next()));
  }
  /** 选题助手 GET：路由内按 IP 限速；带 seed 的 URL 各自为缓存键 */
  if (pathname === "/api/create/hot-topics" && req.method === "GET") {
    return applyNotesAskApiCors(req, withPrivateShortCache(NextResponse.next()));
  }
  if (req.method === "POST" && RATE_LIMIT_EXEMPT_POST_PATHS.has(pathname)) {
    return applyNotesAskApiCors(req, withCacheHeaders(NextResponse.next(), CACHE_API));
  }
  const clientKey = clientRateLimitKey(req);
  if (!checkRateLimit(clientKey)) {
    const r = withCacheHeaders(NextResponse.json({ error: "rate_limited" }, { status: 429 }), CACHE_API);
    if (sensitiveApiPath(pathname)) applySensitiveSharedCacheVary(r, "api");
    return applyNotesAskApiCors(req, r);
  }
  const r = withCacheHeaders(NextResponse.next(), CACHE_API);
  if (sensitiveApiPath(pathname)) applySensitiveSharedCacheVary(r, "api");
  return applyNotesAskApiCors(req, r);
}

export const config = {
  /** 显式包含 `/`：部分 Next 版本下仅 `/(?!...).*` 可能漏匹配首页 */
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"]
};
