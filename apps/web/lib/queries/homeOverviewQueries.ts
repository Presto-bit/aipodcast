"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseHomeOverviewPack, type HomeOverviewApiPack } from "../homeOverviewPackParse";
import type { WorkItem } from "../worksTypes";

export type HomeOverviewMetrics = {
  latestJobId: string;
  latestJobStatus: string;
  worksCount: number;
  notebookCount: number;
  audioDurationSecSum: number;
  scriptCharCountSum: number;
  /** 来自 home-overview 包；可被 activeJobs RQ 覆盖 */
  activeJobsCount: number;
};

export type HomeOverviewPayload = {
  works: WorkItem[];
  overview: HomeOverviewMetrics;
  worksFetchErr: string;
};

export function homeOverviewQueryKey(accountKey: string) {
  return ["home-overview", accountKey] as const;
}

export async function fetchHomeOverview(headers: Record<string, string>): Promise<HomeOverviewPayload> {
  const overviewRes = await fetch("/api/home-overview", {
    cache: "no-store",
    credentials: "same-origin",
    headers
  });
  const pack = (await overviewRes.json().catch(() => ({}))) as HomeOverviewApiPack;
  return parseHomeOverviewPack(pack, overviewRes.status);
}

export function useHomeOverviewQuery(
  getAuthHeaders: () => Record<string, string>,
  enabled: boolean,
  accountKey: string,
  initialData?: HomeOverviewPayload
) {
  const key = homeOverviewQueryKey(accountKey);
  return useQuery({
    queryKey: key,
    queryFn: () => fetchHomeOverview(getAuthHeaders()),
    enabled: enabled && Boolean(accountKey),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    initialData
  });
}

export function useInvalidateHomeOverview() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["home-overview"] });
}
