/**
 * CDN / 共享边缘缓存：敏感路径需避免「仅按 URL」命中同一缓存对象（串数据、旧登录态、旧价目等）。
 * 与 middleware 配合：文档路由追加 Vary 含 Cookie；API 追加 Vary 含 Cookie、Authorization。
 *
 * 阿里云等厂商是否严格尊重 Vary 需在控制台单独配置「缓存键包含 Cookie」等，见 DEPLOYMENT.md。
 */

/** 登录态或强个性化文档：前缀匹配（含自身路径，如 /notes 与 /notes/xxx） */
const SENSITIVE_DOCUMENT_PREFIXES: readonly string[] = [
  "/", // 首页壳子随登录态变化
  "/subscription",
  "/me",
  "/notes",
  "/create",
  "/works",
  "/admin",
  "/jobs",
  "/clip",
  "/voice",
  "/tts",
  "/podcast",
  "/drafts",
  "/settings",
  "/search"
];

function matchesDocumentPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/" || pathname === "";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** 浏览器文档路由（非 /api） */
export function sensitiveDocumentPath(pathname: string): boolean {
  const p = pathname || "";
  for (const prefix of SENSITIVE_DOCUMENT_PREFIXES) {
    if (matchesDocumentPrefix(p, prefix)) return true;
  }
  return false;
}

/**
 * 明确「可匿名、且不应强制按 Cookie 分键」的 BFF 路径。
 * 其余 `/api/*` 一律视为敏感（带 Cookie/Authorization 的常见 BFF），避免共享缓存串会话。
 */
function isPublicApiPath(pathname: string): boolean {
  if (pathname === "/api/auth/login") return true;
  if (pathname.startsWith("/api/auth/register")) return true;
  if (pathname === "/api/auth/forgot-password") return true;
  if (pathname === "/api/auth/reset-password") return true;
  if (pathname === "/api/auth/verify-email") return true;
  if (pathname === "/api/auth/config") return true;

  if (pathname === "/api/default-voices" || pathname.startsWith("/api/default-voices/")) return true;

  if (pathname.startsWith("/api/rss/feed/")) return true;

  if (pathname === "/api/create/hot-topics") return true;

  if (pathname === "/api/notebooks/cover-public" || pathname.startsWith("/api/notebooks/cover-public/")) return true;
  if (pathname === "/api/notebooks/popular" || pathname.startsWith("/api/notebooks/popular/")) return true;

  // 匿名可读的分享页数据（仍可能带鉴权 query，但不应用「无 Cookie」的共享页缓存替代登录态）
  if (/^\/api\/jobs\/[^/]+\/share-public(?:\/|$)/.test(pathname)) return true;

  return false;
}

/** BFF：默认敏感；仅排除 isPublicApiPath */
export function sensitiveApiPath(pathname: string): boolean {
  const p = pathname || "";
  if (!p.startsWith("/api/")) return false;
  if (isPublicApiPath(p)) return false;
  return true;
}
