"use client";

import type { ReactNode } from "react";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";

/** 全屏 nav overlay 已展示骨架时隐藏内层 dynamic loading；progress-only 时仍显示局部骨架。 */
export function useSuppressWorkbenchDynamicLoading(): boolean {
  return useWorkbenchNavOptional()?.navOverlayVisible ?? false;
}

export default function WorkbenchDynamicLoading({ children }: { children: ReactNode }) {
  if (useSuppressWorkbenchDynamicLoading()) return null;
  return children;
}
