"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** 默认关闭 Link prefetch，避免弱网时与当前页导航争抢带宽；hover 时再预取。 */
export const WORKBENCH_LINK_PREFETCH = false;

const prefetched = new Set<string>();

export function prefetchWorkbenchRoute(router: AppRouterInstance, href: string) {
  const path = String(href || "").split("?")[0]?.trim() || "";
  if (!path || prefetched.has(path)) return;
  prefetched.add(path);
  try {
    router.prefetch(path);
  } catch {
    prefetched.delete(path);
  }
}

export function workbenchLinkHoverProps(router: AppRouterInstance, href: string) {
  return {
    prefetch: WORKBENCH_LINK_PREFETCH as false,
    onMouseEnter: () => prefetchWorkbenchRoute(router, href),
    onFocus: () => prefetchWorkbenchRoute(router, href)
  };
}
