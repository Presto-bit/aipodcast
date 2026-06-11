/**
 * 主导航路径匹配与鉴权白名单（与 AppShell 一致，供复用）。
 */

/** 写作 Studio 创作主入口（writing-cursor-studio；侧栏隐藏，深链仍可用） */
export const WORKBENCH_STUDIO_PATH = "/studio";

/** 资料 / 笔记本工作台（侧栏首推心智） */
export const WORKBENCH_NOTES_PATH = "/notes";

/** 经典对话 Composer（原 `/home` 重定向至此） */
export const WORKBENCH_CHAT_PATH = "/chat";

/** 登录后默认工作台路径 */
export const WORKBENCH_DEFAULT_PATH = WORKBENCH_NOTES_PATH;

/** @deprecated 使用 WORKBENCH_CHAT_PATH；保留别名避免大范围替换 */
export const WORKBENCH_HOME_PATH = WORKBENCH_CHAT_PATH;

/** 播客 / 语音合成工作室侧栏入口（独立 pathname，避免 /create 仅改 query 时软路由不刷新） */
export const WORKBENCH_PODCAST_STUDIO_PATH = "/podcast";
export const WORKBENCH_TTS_STUDIO_PATH = "/tts";

/** 工作台侧栏 Link prefetch：改为 hover 预取，见 WorkbenchLink / navPrefetch.ts */
export const WORKBENCH_NAV_PREFETCH = false;

export const NOTES_TEMPLATES_PREFIX = "/notes/templates";
export const NOTES_TRASH_PREFIX = "/notes/trash";
export const WORKS_TRASH_PATH = "/works/trash";

const PRODUCT_STUDIO_ROOTS = ["/create", "/podcast", "/tts"] as const;

export function normalizePathname(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

/** 侧栏 / 软路由：比较 path + query，避免同 pathname 不同 query（如 create mode）被误判为同页。 */
export function parseWorkbenchNavHref(href: string): { path: string; query: string } {
  const [pathPart, queryPart = ""] = href.split("?");
  return {
    path: normalizePathname(pathPart || href),
    query: queryPart.trim()
  };
}

export function isSameWorkbenchNavDestination(
  href: string,
  pathname: string,
  currentQuery: string
): boolean {
  const target = parseWorkbenchNavHref(href);
  const currentPath = normalizePathname(pathname);
  const q = currentQuery.replace(/^\?/, "").trim();
  return target.path === currentPath && target.query === q;
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
  if (
    n === "/" ||
    n === WORKBENCH_CHAT_PATH ||
    n === WORKBENCH_STUDIO_PATH ||
    n === "/me" ||
    n === "/settings"
  ) {
    return true;
  }
  /** 套餐/余额页：允许未登录浏览价目与说明；充值等仍依赖登录态由页面内控制 */
  if (n === "/subscription" || n.startsWith("/subscription/")) return true;
  return pathname.startsWith("/me/") || pathname.startsWith("/settings/");
}

export function matchesProductStudio(pathname: string): boolean {
  return PRODUCT_STUDIO_ROOTS.some((r) => pathMatchesRoot(pathname, r));
}

/** 创作工具折叠组：工作室 + 后期工具路由。 */
export function matchesWorkbenchTools(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (matchesProductStudio(n)) return true;
  if (pathMatchesRoot(n, "/clip")) return true;
  if (pathMatchesRoot(n, "/shownotes")) return true;
  if (pathMatchesRoot(n, "/voice")) return true;
  return false;
}

export function matchesWorksTrash(pathname: string): boolean {
  return pathMatchesRoot(pathname, WORKS_TRASH_PATH);
}

export function matchesNotesWorkbench(pathname: string): boolean {
  return (
    pathMatchesRoot(pathname, "/notes") &&
    !pathname.startsWith(NOTES_TEMPLATES_PREFIX) &&
    !pathname.startsWith(NOTES_TRASH_PREFIX)
  );
}

/** 侧栏一级入口（对话 / 资料 / 作品）：进入子页时保持 232px 宽轨。 */
export function shouldKeepSidebarExpanded(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (pathMatchesRoot(n, "/notes") && n !== "/notes") return true;
  if (pathMatchesRoot(n, "/works") && n !== "/works") return true;
  if (pathMatchesRoot(n, WORKBENCH_STUDIO_PATH) && n !== WORKBENCH_STUDIO_PATH) return true;
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
  if (matchesWorksTrash(n)) return true;
  if (pathMatchesRoot(n, "/admin/works")) return true;
  if (pathMatchesRoot(n, "/clip")) return true;
  if (pathMatchesRoot(n, "/voice")) return true;
  if (pathMatchesRoot(n, "/shownotes")) return true;
  if (matchesNotesWorkbench(n)) return true;
  return false;
}
