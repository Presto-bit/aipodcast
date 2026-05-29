"use client";

import { useQuery } from "@tanstack/react-query";
import type { NotebookMeta } from "../../components/notes/notesNotebookTypes";

export const NOTEBOOKS_META_QUERY_KEY = ["notebooks-meta"] as const;

export async function fetchNotebooksMeta(
  headers: Record<string, string>
): Promise<Record<string, NotebookMeta>> {
  const res = await fetch("/api/notebooks/stats", {
    credentials: "same-origin",
    cache: "no-store",
    headers
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    statsByNotebook?: Record<string, NotebookMeta>;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !data.success || !data.statsByNotebook) {
    throw new Error(data.error || data.detail || `加载笔记本统计失败 ${res.status}`);
  }
  return data.statsByNotebook;
}

export function useNotebooksMetaQuery(getAuthHeaders: () => Record<string, string>, enabled: boolean) {
  return useQuery({
    queryKey: NOTEBOOKS_META_QUERY_KEY,
    queryFn: () => fetchNotebooksMeta(getAuthHeaders()),
    enabled,
    staleTime: 60_000
  });
}
