/**
 * 主导航路径匹配与鉴权白名单（与 AppShell 一致，供复用）。
 */

/** 工作台聚合首页（原根路径 `/`）；公开营销落地页仍为 `/`。 */
export const WORKBENCH_HOME_PATH = "/home";

/** 工作台侧栏 Link prefetch：改为 hover 预取，见 WorkbenchLink / navPrefetch.ts */
export const WORKBENCH_NAV_PREFETCH = false;

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

/** 根路径为营销介绍页：无 AppShell 侧栏等工作台壳层 */
export function isMarketingShellLessPath(pathname: string): boolean {
  return normalizePathname(pathname) === "/";
}

/** 未登录时可停留的页面（与鉴权 redirect 白名单一致） */
export function isAuthPublicPath(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (n === "/forgot-password" || n === "/reset-password" || n === "/verify-email") return true;
  if (n === "/help") return true;
  if (n.startsWith("/legal/")) return true;
  if (n === "/" || n === WORKBENCH_HOME_PATH || n === "/me" || n === "/settings") return true;
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

/** 侧栏一级入口（知识库 / 创作播客 / 我的作品）：进入时保持 232px 宽轨，不收成 72px 窄轨 */
export function shouldKeepSidebarExpanded(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (pathMatchesRoot(n, "/notes")) return true;
  if (matchesProductStudio(n)) return true;
  if (pathMatchesRoot(n, "/works")) return true;
  return false;
}

export function matchesAdminConsole(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, "/admin");
}

/** 需要全局作品试听 Player 的路由（其余页不挂载 WorkAudioShell）。 */
export function pathNeedsWorkAudio(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (n === WORKBENCH_HOME_PATH) return true;
  if (matchesProductStudio(n)) return true;
  if (pathMatchesRoot(n, "/works")) return true;
  if (pathMatchesRoot(n, "/admin/works")) return true;
  if (pathMatchesRoot(n, "/clip")) return true;
  if (pathMatchesRoot(n, "/voice")) return true;
  if (pathMatchesRoot(n, "/shownotes")) return true;
  if (matchesNotesWorkbench(n)) return true;
  return false;
}
