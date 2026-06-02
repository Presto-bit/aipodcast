"use client";

import type { QueryClient } from "@tanstack/react-query";
import { routeHasWarmChunks, routeIsPrefetched } from "./navPrefetch";
import { normalizePathname } from "./navPaths";
import { routeHasWarmQueryCache } from "./queries/workbenchRouteQueryCache";

export type WorkbenchNavWarmthTier = "instant" | "semi" | "cold";

/**
 * 导航温区：
 * - instant：Query 或重 chunk 已就绪 → 仅顶部 progress
 * - semi：至少 router.prefetch → progress，保留旧页（不盖全屏骨架）
 * - cold：全无 → 全屏骨架 + 硬跳 900ms
 */
export function resolveWorkbenchNavWarmthTier(
  queryClient: QueryClient,
  hrefOrPath: string
): WorkbenchNavWarmthTier {
  const path = normalizePathname(String(hrefOrPath || "").split("?")[0] || hrefOrPath);
  if (!path) return "cold";
  if (routeHasWarmQueryCache(queryClient, path)) return "instant";
  if (routeHasWarmChunks(path)) return "instant";
  if (routeIsPrefetched(path)) return "semi";
  return "cold";
}

export function workbenchNavHardJumpMs(tier: WorkbenchNavWarmthTier): number {
  if (tier === "instant") return 400;
  if (tier === "semi") return 650;
  return 900;
}

export function workbenchNavClearPendingDelayMs(tier: WorkbenchNavWarmthTier): number {
  if (tier === "instant") return 0;
  if (tier === "semi") return 80;
  return 180;
}

/** 非 cold 视为可跳过全屏 overlay（兼容旧 warm route 判定）。 */
export function routeHasWarmRouteCache(queryClient: QueryClient, hrefOrPath: string): boolean {
  return resolveWorkbenchNavWarmthTier(queryClient, hrefOrPath) !== "cold";
}
