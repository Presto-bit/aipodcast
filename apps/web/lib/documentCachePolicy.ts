import { normalizePathname } from "./navPaths";

/** 可 ISR/静态缓存的文档路由（不在 layout 中调用 cookies()） */
const STATIC_DOCUMENT_EXACT = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/help"
]);

const STATIC_DOCUMENT_PREFIXES = ["/legal/"] as const;

export function isStaticDocumentPath(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (STATIC_DOCUMENT_EXACT.has(n)) return true;
  return STATIC_DOCUMENT_PREFIXES.some((p) => n === p.slice(0, -1) || n.startsWith(p));
}

/** 工作台等敏感文档：需 force-dynamic + 服务端会话注入 */
export function isWorkbenchDocumentPath(pathname: string): boolean {
  return !isStaticDocumentPath(pathname) && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/");
}
