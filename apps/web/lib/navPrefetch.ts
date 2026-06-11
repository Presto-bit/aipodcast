"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  prefetchWorkbenchRouteData,
  type PrefetchWorkbenchRouteOptions
} from "./prefetchWorkbenchRouteData";
import { normalizePathname } from "./navPaths";

export type { PrefetchWorkbenchRouteOptions };

/** 默认关闭 Link prefetch，避免弱网时与当前页导航争抢带宽；hover / idle 时再预取。 */
export const WORKBENCH_LINK_PREFETCH = false;

/** 侧栏 idle 预取的高频工作台路由 */
export const WORKBENCH_SIDEBAR_IDLE_ROUTES = [
  "/notes",
  "/works",
  "/create",
  "/clip",
  "/shownotes",
  "/voice",
  "/subscription",
  "/works/trash"
] as const;

/** 登录后 idle 分批预取的次级侧栏路由（不阻塞首屏）。 */
export const WORKBENCH_LOGIN_PREFETCH_ROUTES_SECONDARY = [
  "/clip",
  "/shownotes",
  "/voice",
  "/subscription",
  "/works/trash"
] as const;

/** 登录后立即预取的高频入口（不等 idle） */
export const WORKBENCH_LOGIN_PREFETCH_ROUTES = ["/notes", "/create", "/works"] as const;

const prefetchedRoutes = new Set<string>();
const warmedChunkIds = new Set<string>();

/** 路由是否已通过 router.prefetch 或 idle 预取标记 */
export function routeIsPrefetched(hrefOrPath: string): boolean {
  const path = normalizePathname(String(hrefOrPath || "").split("?")[0] || hrefOrPath);
  return Boolean(path) && prefetchedRoutes.has(path);
}

/** 重 chunk 是否已 warm（用于跳过 navPending 全屏骨架） */
const ROUTE_WARM_CHUNK_IDS: Record<string, readonly string[]> = {
  "/clip": ["clip-hub"],
  "/voice": ["voice-clone", "voice-my", "voice-persona"],
  "/shownotes": ["shownotes-landing"],
  "/works/trash": ["works-trash"],
  "/notes/trash": ["works-trash"]
};

export function routeHasWarmChunks(hrefOrPath: string): boolean {
  const path = normalizePathname(String(hrefOrPath || "").split("?")[0] || hrefOrPath);
  if (!path) return false;
  const chunkIds = ROUTE_WARM_CHUNK_IDS[path];
  if (!chunkIds?.length) return routeIsPrefetched(path);
  return chunkIds.every((id) => warmedChunkIds.has(id));
}

function warmChunk(id: string, loader: () => Promise<unknown>) {
  if (warmedChunkIds.has(id)) return;
  warmedChunkIds.add(id);
  void loader().catch(() => {
    warmedChunkIds.delete(id);
  });
}

/** 按目标路由预热常见 dynamic import chunk。 */
export function warmWorkbenchRouteChunks(href: string) {
  const path = normalizePathname(String(href || "").split("?")[0] || href);
  if (!path) return;

  if (path === "/works" || path === "/create") {
    warmChunk("podcast-works-gallery", () => import("../components/podcast/PodcastWorksGallery"));
  }
  if (pathMatchesNotes(path)) {
    warmChunk("notes-works-panel", () => import("../components/works/NotesWorkbenchWorksPanel"));
  }
  if (path === "/notes") {
    warmChunk("notes-hub", () => import("../components/notes/NotesHubPage"));
  }
  if (pathMatchesNotes(path) && path !== "/notes" && path !== "/notes/trash") {
    warmChunk("notes-page-main", () => import("../components/notes/NotesPageMain"));
  }
  if (path === "/create" || pathMatchesRoot(path, "/podcast") || pathMatchesRoot(path, "/tts")) {
    warmChunk("podcast-studio", () => import("../components/studio/PodcastStudio"));
    warmChunk("tts-studio", () => import("../components/studio/TtsStudio"));
  }
  if (path === "/clip") {
    warmChunk("clip-hub", () => import("../components/clip/ClipHub"));
  }
  if (path === "/voice" || path.startsWith("/voice/")) {
    warmChunk("voice-clone", () => import("../components/voice/VoiceClonePanel"));
    warmChunk("voice-my", () => import("../components/voice/MyVoicesPanel"));
    warmChunk("voice-persona", () => import("../components/voice/UserTemplatesPanel"));
  }
  if (path === "/shownotes" || path.startsWith("/shownotes/")) {
    warmChunk("shownotes-landing", () => import("../components/shownotes/ShownotesLandingClient"));
  }
  if (path === "/works/trash" || path === "/notes/trash") {
    warmChunk("works-trash", () => import("../components/works/WorksTrashPageClient"));
  }
}

function pathMatchesNotes(path: string): boolean {
  return path === "/notes" || path.startsWith("/notes/");
}

function pathMatchesRoot(pathname: string, base: string): boolean {
  const n = normalizePathname(pathname);
  const b = normalizePathname(base);
  return n === b || n.startsWith(`${b}/`);
}

export function prefetchWorkbenchRoute(
  router: AppRouterInstance,
  href: string,
  opts?: PrefetchWorkbenchRouteOptions
) {
  const path = String(href || "").split("?")[0]?.trim() || "";
  if (!path) return;
  if (!prefetchedRoutes.has(path)) {
    prefetchedRoutes.add(path);
    try {
      router.prefetch(path);
    } catch {
      prefetchedRoutes.delete(path);
    }
  }
  warmWorkbenchRouteChunks(path);
  if (opts?.queryClient && opts.headers) {
    prefetchWorkbenchRouteData(opts.queryClient, path, opts.headers, opts.accountKey);
  }
}

/** AppShell 空闲时分批预取侧栏高频路由与重 chunk。 */
export function prefetchWorkbenchSidebarIdle(
  router: AppRouterInstance,
  opts?: PrefetchWorkbenchRouteOptions
) {
  const routes = WORKBENCH_SIDEBAR_IDLE_ROUTES;
  let index = 0;

  const step = () => {
    if (index >= routes.length) return;
    prefetchWorkbenchRoute(router, routes[index]!, opts);
    index += 1;
    if (index < routes.length) {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(step, { timeout: 200 });
      } else {
        window.setTimeout(step, 40);
      }
    }
  };

  step();
}

export function workbenchLinkHoverProps(router: AppRouterInstance, href: string) {
  return {
    prefetch: WORKBENCH_LINK_PREFETCH as false,
    onMouseEnter: () => prefetchWorkbenchRoute(router, href),
    onFocus: () => prefetchWorkbenchRoute(router, href)
  };
}
