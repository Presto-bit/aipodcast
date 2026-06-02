"use client";

import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";
import WorkbenchRouteFallback from "./WorkbenchRouteFallback";

/** 半温/即时切换时不盖 Suspense 骨架，保留旧页直至新路由就绪。 */
export default function WorkbenchRouteSuspenseFallback() {
  const nav = useWorkbenchNavOptional();
  if (nav?.navPending && nav.navWarmthTier !== "cold") {
    return null;
  }
  return <WorkbenchRouteFallback />;
}
