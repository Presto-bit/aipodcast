/**
 * 主导航路径匹配与鉴权白名单（与 AppShell 一致，供复用）。
 */

/** 资料 / 笔记本工作台（侧栏首推心智） */
export const WORKBENCH_NOTES_PATH = "/notes";

/** 登录后默认工作台路径 */
export const WORKBENCH_DEFAULT_PATH = WORKBENCH_NOTES_PATH;

/** @deprecated 历史 /home、/chat 已下线；请用 WORKBENCH_DEFAULT_PATH */
export const WORKBENCH_HOME_PATH = WORKBENCH_NOTES_PATH;

/** 播客 / 语音合成工作室侧栏入口（独立 pathname，避免 /create 仅改 query 时软路由不刷新） */
export const WORKBENCH_PODCAST_STUDIO_PATH = "/podcast";
export const WORKBENCH_TTS_STUDIO_PATH = "/podcast/tts";
export const WORKBENCH_PODCAST_CLIP_PATH = "/podcast/clip";
export const WORKBENCH_PODCAST_SHOWNOTES_PATH = "/podcast/shownotes";
export const WORKBENCH_PODCAST_VOICE_PATH = "/podcast/voice";

/** 工作台侧栏 Link prefetch：改为 hover 预取，见 WorkbenchLink / navPrefetch.ts */
export const WORKBENCH_NAV_PREFETCH = false;

export const NOTES_TEMPLATES_PREFIX = "/notes/templates";
export const NOTES_TRASH_PREFIX = "/notes/trash";
export const WORKS_TRASH_PATH = "/works/trash";

const PRODUCT_STUDIO_ROOTS = ["/create", "/podcast"] as const;

const LEGACY_PODCAST_TOOL_ROOTS = ["/tts", "/clip", "/shownotes", "/voice"] as const;

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
  if (n === "/" || n === "/me" || n === "/settings") {
    return true;
  }
  /** 套餐/余额页：允许未登录浏览价目与说明；充值等仍依赖登录态由页面内控制 */
  if (n === "/subscription" || n.startsWith("/subscription/")) return true;
  return pathname.startsWith("/me/") || pathname.startsWith("/settings/");
}

export function matchesProductStudio(pathname: string): boolean {
  return PRODUCT_STUDIO_ROOTS.some((r) => pathMatchesRoot(pathname, r));
}

/** 播客侧栏父项「播客」：仅工作室入口，不含 TTS / 剪辑等子工具。 */
export function matchesPodcastStudioEntry(pathname: string): boolean {
  return normalizePathname(pathname) === WORKBENCH_PODCAST_STUDIO_PATH;
}

export function matchesPodcastTtsStudio(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, WORKBENCH_TTS_STUDIO_PATH) || pathMatchesRoot(n, "/tts");
}

export function matchesPodcastClip(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, WORKBENCH_PODCAST_CLIP_PATH) || pathMatchesRoot(n, "/clip");
}

export function matchesPodcastShownotes(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, WORKBENCH_PODCAST_SHOWNOTES_PATH) || pathMatchesRoot(n, "/shownotes");
}

export function matchesPodcastVoice(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, WORKBENCH_PODCAST_VOICE_PATH) || pathMatchesRoot(n, "/voice");
}

/** 创作工具折叠组：工作室 + 后期工具路由。 */
export function matchesWorkbenchTools(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (matchesProductStudio(n)) return true;
  if (LEGACY_PODCAST_TOOL_ROOTS.some((r) => pathMatchesRoot(n, r))) return true;
  if (pathMatchesRoot(n, WORKBENCH_PODCAST_CLIP_PATH)) return true;
  if (pathMatchesRoot(n, WORKBENCH_PODCAST_SHOWNOTES_PATH)) return true;
  if (pathMatchesRoot(n, WORKBENCH_PODCAST_VOICE_PATH)) return true;
  if (pathMatchesRoot(n, WORKBENCH_TTS_STUDIO_PATH)) return true;
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

/** 侧栏一级入口：进入子页时保持 232px 宽轨。 */
export function shouldKeepSidebarExpanded(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (pathMatchesRoot(n, "/notes") && n !== "/notes") return true;
  if (pathMatchesRoot(n, "/works") && n !== "/works") return true;
  return false;
}

export function matchesAdminConsole(pathname: string): boolean {
  const n = normalizePathname(pathname);
  return pathMatchesRoot(n, "/admin");
}

/** 需要全局作品试听 Player 的路由（其余页不挂载 WorkAudioShell）。 */
export function pathNeedsWorkAudio(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (matchesProductStudio(n)) return true;
  if (pathMatchesRoot(n, "/works")) return true;
  if (matchesWorksTrash(n)) return true;
  if (pathMatchesRoot(n, "/admin/works")) return true;
  if (matchesPodcastClip(n)) return true;
  if (matchesPodcastVoice(n)) return true;
  if (matchesPodcastShownotes(n)) return true;
  if (matchesPodcastTtsStudio(n)) return true;
  if (matchesNotesWorkbench(n)) return true;
  return false;
}
