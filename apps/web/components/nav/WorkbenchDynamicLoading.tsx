"use client";

import type { ReactNode } from "react";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";

/** 半温/即时切换时不重复显示 dynamic loading；cold 全屏 overlay 时亦隐藏内层。 */
export function useSuppressWorkbenchDynamicLoading(): boolean {
  const nav = useWorkbenchNavOptional();
  if (!nav?.navPending) return false;
  if (nav.navOverlayVisible) return true;
  return nav.navWarmthTier !== "cold";
}

export default function WorkbenchDynamicLoading({ children }: { children: ReactNode }) {
  if (useSuppressWorkbenchDynamicLoading()) return null;
  return children;
}
