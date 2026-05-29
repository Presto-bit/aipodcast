"use client";

import type { ReactNode } from "react";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";

/** AppShell navPending overlay 已展示骨架时，内层 dynamic loading 不再重复渲染。 */
export function useSuppressWorkbenchDynamicLoading(): boolean {
  return useWorkbenchNavOptional()?.navPending ?? false;
}

export default function WorkbenchDynamicLoading({ children }: { children: ReactNode }) {
  if (useSuppressWorkbenchDynamicLoading()) return null;
  return children;
}
