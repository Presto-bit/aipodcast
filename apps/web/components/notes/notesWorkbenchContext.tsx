"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { NotesWorkbenchContextValue } from "./notesWorkbenchTypes";

const NotesWorkbenchContext = createContext<NotesWorkbenchContextValue | null>(null);

export function NotesWorkbenchProvider({
  value,
  children
}: {
  value: NotesWorkbenchContextValue;
  children: ReactNode;
}) {
  return <NotesWorkbenchContext.Provider value={value}>{children}</NotesWorkbenchContext.Provider>;
}

export function useNotesWorkbench(): NotesWorkbenchContextValue {
  const ctx = useContext(NotesWorkbenchContext);
  if (!ctx) {
    throw new Error("useNotesWorkbench must be used within NotesWorkbenchProvider");
  }
  return ctx;
}
