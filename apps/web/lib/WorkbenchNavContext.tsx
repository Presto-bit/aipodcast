"use client";

import { createContext, useContext } from "react";

export type WorkbenchNavContextValue = {
  navPending: boolean;
  /** 全屏骨架 overlay 是否可见（progress-only 时为 false） */
  navOverlayVisible: boolean;
  beginWorkbenchNav: (href: string) => void;
};

export const WorkbenchNavContext = createContext<WorkbenchNavContextValue | null>(null);

export function useWorkbenchNav(): WorkbenchNavContextValue {
  const ctx = useContext(WorkbenchNavContext);
  if (!ctx) {
    throw new Error("useWorkbenchNav must be used within WorkbenchNavContext.Provider");
  }
  return ctx;
}

export function useWorkbenchNavOptional(): WorkbenchNavContextValue | null {
  return useContext(WorkbenchNavContext);
}
