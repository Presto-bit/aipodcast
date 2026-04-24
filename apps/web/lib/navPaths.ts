/**
 * 主导航路径匹配与鉴权白名单（与 AppShell 一致，供复用）。
 */

export const NOTES_TEMPLATES_PREFIX = "/notes/templates";
export const NOTES_TRASH_PREFIX = "/notes/trash";

const PRODUCT_STUDIO_ROOTS = ["/create", "/podcast", "/tts"] as const;

export function normalizePathname(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

export function pathMatchesRoot(pathname: string, base: string): boolean {
  const n = normalizePathname(pathname);
  const b = normalizePathname(base);
  return n === b || n.startsWith(`${b}/`);
}

/** 未登录时可停留的页面（与鉴权 redirect 白名单一致） */
export function isAuthPublicPath(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (n === "/forgot-password" || n === "/reset-password" || n === "/verify-email") return true;
  if (n === "/help") return true;
  if (n.startsWith("/legal/")) return true;
  if (n === "/" || n === "/me" || n === "/settings") return true;
  /** 套餐/余额页：允许未登录浏览价目与说明；充值等仍依赖登录态由页面内控制 */
  if (n === "/subscription" || n.startsWith("/subscription/")) return true;
  return pathname.startsWith("/me/") || pathname.startsWith("/settings/");
}

export function matchesProductStudio(pathname: string): boolean {
  return PRODUCT_STUDIO_ROOTS.some((r) => pathMatchesRoot(pathname, r));
}

export function matchesNotesWorkbench(pathname: string): boolean {
  return (
    pathMatchesRoot(pathname, "/notes") &&
    !pathname.startsWith(NOTES_TEMPLATES_PREFIX) &&
    !pathname.startsWith(NOTES_TRASH_PREFIX)
  );
}

export function matchesAdminConsole(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, "/admin");
}
