"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeUserFacingWorksByRecency, type WorkItem } from "../worksTypes";

export type WorksApiPayload = {
  ai: WorkItem[];
  tts: WorkItem[];
  notes: WorkItem[];
  total?: number;
  hasMore?: boolean;
};

export type WorksListQueryOptions = {
  limit?: number;
  offset?: number;
};

async function fetchWorksPage(
  headers: Record<string, string>,
  opts: WorksListQueryOptions = {}
): Promise<WorksApiPayload> {
  const limit = opts.limit ?? 80;
  const offset = opts.offset ?? 0;
  const res = await fetch(`/api/works?limit=${limit}&offset=${offset}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    ai?: WorkItem[];
    tts?: WorkItem[];
    notes?: WorkItem[];
    total?: number;
    has_more?: boolean;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
  }
  return {
    ai: Array.isArray(data.ai) ? data.ai : [],
    tts: Array.isArray(data.tts) ? data.tts : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    total: typeof data.total === "number" ? data.total : undefined,
    hasMore: Boolean(data.has_more)
  };
}

/** 用户可见作品合并列表（ai + tts + notes，按时间） */
export function mergeWorksPayload(payload: WorksApiPayload): WorkItem[] {
  return mergeUserFacingWorksByRecency(payload.ai, payload.tts, payload.notes);
}

export function worksListQueryKey(limit: number, offset: number) {
  return ["works-list", limit, offset] as const;
}

export function useWorksListQuery(
  getAuthHeaders: () => Record<string, string>,
  loggedIn: boolean,
  opts: WorksListQueryOptions = {}
) {
  const limit = opts.limit ?? 80;
  const offset = opts.offset ?? 0;
  return useQuery({
    queryKey: worksListQueryKey(limit, offset),
    queryFn: () => fetchWorksPage(getAuthHeaders(), { limit, offset }),
    enabled: loggedIn,
    staleTime: 30_000
  });
}

/** 创作页「最近成品」：排除笔记本工作室同名项目 */
export function useCreateRecentWorksQuery(
  getAuthHeaders: () => Record<string, string>,
  loggedIn: boolean,
  excludeProjectName: string,
  limit = 80
) {
  const q = useWorksListQuery(getAuthHeaders, loggedIn, { limit, offset: 0 });
  const filtered = q.data
    ? mergeWorksPayload(q.data).filter((w) => String(w.projectName || "").trim() !== excludeProjectName)
    : undefined;
  return { ...q, filteredWorks: filtered };
}

export function useInvalidateWorksOnMutation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["works-list"] });
  };
}
