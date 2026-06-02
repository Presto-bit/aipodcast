"use client";

import type { QueryClient } from "@tanstack/react-query";
import { matchesProductStudio, normalizePathname, WORKBENCH_HOME_PATH } from "./navPaths";
import { fetchHomeOverview, homeOverviewQueryKey } from "./queries/homeOverviewQueries";
import { fetchNotebooksHub, NOTEBOOKS_HUB_QUERY_KEY } from "./queries/notebooksQueries";
import { fetchStudioBootstrap } from "./queries/studioQueries";
import { fetchWorksPage, worksListQueryKey } from "./queries/worksQueries";

const WORKS_PREFETCH_LIMIT = 60;
const CREATE_WORKS_LIMIT = 80;

const prefetchedDataRoutes = new Set<string>();

function prefetchQuery(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<unknown>
) {
  const state = queryClient.getQueryState(queryKey);
  if (state?.status === "success" || state?.fetchStatus === "fetching") return;
  void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: 60_000 });
}

/** pointerdown / idle 时并行预取目标页 API，减轻 mount 后白等。 */
export function prefetchWorkbenchRouteData(
  queryClient: QueryClient,
  hrefOrPath: string,
  headers: Record<string, string>,
  accountKey?: string
) {
  if (!headers || Object.keys(headers).length === 0) return;
  const path = normalizePathname(String(hrefOrPath || "").split("?")[0] || hrefOrPath);
  if (!path) return;

  const cacheKey = `${path}:${accountKey ?? ""}`;
  if (prefetchedDataRoutes.has(cacheKey)) return;
  prefetchedDataRoutes.add(cacheKey);

  if (path === WORKBENCH_HOME_PATH) {
    if (accountKey) {
      prefetchQuery(queryClient, homeOverviewQueryKey(accountKey), () => fetchHomeOverview(headers));
    }
    prefetchQuery(queryClient, worksListQueryKey(CREATE_WORKS_LIMIT, 0), () =>
      fetchWorksPage(headers, { limit: CREATE_WORKS_LIMIT, offset: 0 })
    );
    return;
  }

  if (path === "/works") {
    prefetchQuery(queryClient, worksListQueryKey(WORKS_PREFETCH_LIMIT, 0), () =>
      fetchWorksPage(headers, { limit: WORKS_PREFETCH_LIMIT, offset: 0 })
    );
    return;
  }

  if (path === "/notes" || (path.startsWith("/notes/") && path !== "/notes/trash")) {
    prefetchQuery(queryClient, NOTEBOOKS_HUB_QUERY_KEY, () => fetchNotebooksHub(headers));
    return;
  }

  if (path === "/create" || matchesProductStudio(path)) {
    prefetchQuery(queryClient, ["studio-bootstrap"], () => fetchStudioBootstrap(headers));
    prefetchQuery(queryClient, worksListQueryKey(CREATE_WORKS_LIMIT, 0), () =>
      fetchWorksPage(headers, { limit: CREATE_WORKS_LIMIT, offset: 0 })
    );
  }
}

export type PrefetchWorkbenchRouteOptions = {
  queryClient?: QueryClient;
  headers?: Record<string, string>;
  accountKey?: string;
};
