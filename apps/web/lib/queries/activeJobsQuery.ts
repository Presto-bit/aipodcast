"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listJobs } from "../api";
import { countUserVisibleActiveJobs } from "../activeJobsVisible";
import type { JobRecord } from "../types";

const ACTIVE_JOBS_QUERY_KEY = ["active-jobs"] as const;
const ACTIVE_JOBS_LIMIT = 80;
const ACTIVE_JOBS_STALE_MS = 5_000;
const ACTIVE_JOBS_POLL_MS = 5_000;

async function fetchActiveJobs(): Promise<JobRecord[]> {
  const { jobs } = await listJobs({
    limit: ACTIVE_JOBS_LIMIT,
    offset: 0,
    status: "queued,running",
    slim: true
  });
  return Array.isArray(jobs) ? jobs : [];
}

/** 全站共享：进行中任务列表 + 计数；页面离开仍缓存，5s 轮询（仅 tab 可见时）。 */
export function useActiveJobsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ACTIVE_JOBS_QUERY_KEY,
    queryFn: fetchActiveJobs,
    enabled,
    staleTime: ACTIVE_JOBS_STALE_MS,
    refetchInterval: (query) => {
      if (!enabled) return false;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      if (query.state.data && query.state.data.length === 0) return ACTIVE_JOBS_POLL_MS * 2;
      return ACTIVE_JOBS_POLL_MS;
    }
  });
}

export function useActiveJobCount(enabled: boolean): number | null {
  const q = useActiveJobsQuery(enabled);
  if (!enabled) return 0;
  if (q.isLoading && !q.data) return null;
  if (q.isError) return null;
  return countUserVisibleActiveJobs(q.data ?? []);
}

export function useInvalidateActiveJobs() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ACTIVE_JOBS_QUERY_KEY });
}
