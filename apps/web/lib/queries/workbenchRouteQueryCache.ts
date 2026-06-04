"use client";

import type { QueryClient } from "@tanstack/react-query";
import { routeHasWarmChunks } from "../navPrefetch";
import { matchesProductStudio, normalizePathname, WORKBENCH_HOME_PATH, WORKBENCH_STUDIO_PATH, pathMatchesRoot } from "../navPaths";
import { NOTEBOOKS_HUB_QUERY_KEY } from "./notebooksQueries";
import { worksListQueryKey } from "./worksQueries";

const WORKS_PAGE_LIMIT = 60;

/** 目标路由是否已有 React Query 成功缓存（用于跳过 navPending 全屏骨架）。 */
export function routeHasWarmQueryCache(queryClient: QueryClient, hrefOrPath: string): boolean {
  const path = normalizePathname(String(hrefOrPath || "").split("?")[0] || hrefOrPath);
  if (!path) return false;

  const hasSuccess = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.status === "success";

  if (path === WORKBENCH_HOME_PATH) {
    const entries = queryClient.getQueriesData({ queryKey: ["home-overview"] });
    return entries.some(([, data]) => data != null);
  }

  if (path === "/works") {
    return hasSuccess(worksListQueryKey(WORKS_PAGE_LIMIT, 0));
  }

  if (path === WORKBENCH_STUDIO_PATH || pathMatchesRoot(path, WORKBENCH_STUDIO_PATH)) {
    return hasSuccess(NOTEBOOKS_HUB_QUERY_KEY) || routeHasWarmChunks(path);
  }

  if (path === "/notes") {
    return hasSuccess(NOTEBOOKS_HUB_QUERY_KEY);
  }

  if (path.startsWith("/notes/") && path !== "/notes/trash") {
    return hasSuccess(NOTEBOOKS_HUB_QUERY_KEY);
  }

  if (path === "/create" || matchesProductStudio(path)) {
    return hasSuccess(["studio-bootstrap"]);
  }

  if (path === "/subscription" || path.startsWith("/subscription/")) {
    return hasSuccess(["subscription-plans"]);
  }

  if (path === "/drafts" || path.startsWith("/drafts/")) {
    return routeHasWarmChunks(path);
  }

  if (path === "/works/trash" || path === "/notes/trash") {
    return routeHasWarmChunks("/works/trash");
  }

  if (path === "/shownotes" || path.startsWith("/shownotes/")) {
    return routeHasWarmChunks(path);
  }

  if (path === "/clip" || path.startsWith("/clip/")) {
    return routeHasWarmChunks(path);
  }

  if (path === "/voice" || path.startsWith("/voice/")) {
    return routeHasWarmChunks(path);
  }

  return false;
}
