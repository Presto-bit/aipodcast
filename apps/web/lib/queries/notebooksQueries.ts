"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotebookCoverMeta } from "../../components/notes/notesNotebookTypes";
import type { NotebookSharingRow } from "../../components/notes/notesNotebookTypes";

export type NotebooksHubPayload = {
  notebooks: string[];
  notebookSharing: Record<string, NotebookSharingRow>;
  notebookCovers: Record<string, NotebookCoverMeta>;
};

export const NOTEBOOKS_HUB_QUERY_KEY = ["notebooks-hub"] as const;

export async function fetchNotebooksHub(headers: Record<string, string>): Promise<NotebooksHubPayload> {
  const res = await fetch("/api/notebooks", {
    credentials: "same-origin",
    cache: "no-store",
    headers
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    notebooks?: string[];
    notebookSharing?: Record<string, NotebookSharingRow>;
    notebookCovers?: Record<string, NotebookCoverMeta>;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.detail || `加载笔记本失败 ${res.status}`);
  }
  return {
    notebooks: Array.isArray(data.notebooks) ? data.notebooks : [],
    notebookSharing:
      data.notebookSharing && typeof data.notebookSharing === "object" ? data.notebookSharing : {},
    notebookCovers: data.notebookCovers && typeof data.notebookCovers === "object" ? data.notebookCovers : {}
  };
}

export function useNotebooksHubQuery(getAuthHeaders: () => Record<string, string>, enabled: boolean) {
  return useQuery({
    queryKey: NOTEBOOKS_HUB_QUERY_KEY,
    queryFn: () => fetchNotebooksHub(getAuthHeaders()),
    enabled,
    staleTime: 60_000
  });
}

export function useInvalidateNotebooksHub() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: NOTEBOOKS_HUB_QUERY_KEY });
}
