import { apiErrorMessage } from "./apiError";
import { countUserVisibleActiveJobs } from "./activeJobsVisible";
import type { HomeOverviewMetrics, HomeOverviewPayload } from "./queries/homeOverviewQueries";
import type { JobRecord } from "./types";
import { mergeUserFacingWorksByRecency, type WorkItem } from "./worksTypes";

export type HomeOverviewApiPack = {
  jobsLimit1?: { ok: boolean; status: number; data: unknown };
  jobsActive?: { ok: boolean; status: number; data: unknown };
  works?: { ok: boolean; status: number; data: unknown };
  worksMetrics?: { ok: boolean; status: number; data: unknown };
  notesMetrics?: { ok: boolean; status: number; data: unknown };
};

/** 解析 /api/home-overview 或编排器并行子请求的聚合包（RSC / 客户端共用）。 */
export function parseHomeOverviewPack(pack: HomeOverviewApiPack, worksHttpStatus = 200): HomeOverviewPayload {
  const jobsData = (pack.jobsLimit1?.data ?? {}) as { jobs?: Array<{ id?: string; status?: string }> };
  const activeJobsData = (pack.jobsActive?.data ?? {}) as {
    jobs?: unknown[];
    success?: boolean;
  };
  const worksPart = pack.works;
  const worksData = (worksPart?.data ?? {}) as {
    ai?: WorkItem[];
    tts?: WorkItem[];
    notes?: WorkItem[];
    success?: boolean;
    error?: string;
    detail?: string;
  };
  const wm = (pack.worksMetrics?.data ?? {}) as {
    success?: boolean;
    worksCount?: number;
    audioDurationSecSum?: number;
    scriptCharCountSum?: number;
  };
  const nm = (pack.notesMetrics?.data ?? {}) as { success?: boolean; notebookCount?: number };
  const worksMetricsOk = Boolean(pack.worksMetrics?.ok) && wm.success !== false;
  const notesMetricsOk = Boolean(pack.notesMetrics?.ok) && nm.success !== false;
  const worksResOk = worksPart?.ok ?? false;
  const latest = Array.isArray(jobsData.jobs) && jobsData.jobs.length > 0 ? jobsData.jobs[0] : null;
  const activeJobsOk =
    Boolean(pack.jobsActive?.ok) && activeJobsData.success !== false && Array.isArray(activeJobsData.jobs);
  const ai = Array.isArray(worksData.ai) ? worksData.ai : [];
  const tts = Array.isArray(worksData.tts) ? worksData.tts : [];
  const notesWorks = Array.isArray(worksData.notes) ? worksData.notes : [];
  const merged = mergeUserFacingWorksByRecency(ai, tts, notesWorks);
  const worksOkForList = worksResOk && worksData.success !== false;

  let worksFetchErr = "";
  if (!worksOkForList && merged.length === 0) {
    worksFetchErr = apiErrorMessage(
      { error: worksData.error, detail: worksData.detail },
      `作品加载失败（${worksPart?.status ?? worksHttpStatus}）`
    );
  }

  const activeJobsCount = activeJobsOk
    ? countUserVisibleActiveJobs(activeJobsData.jobs as JobRecord[])
    : 0;

  const overview: HomeOverviewMetrics = {
    latestJobId: String(latest?.id || "").trim(),
    latestJobStatus: String(latest?.status || "—"),
    worksCount: worksMetricsOk ? Number(wm.worksCount ?? merged.length) : merged.length,
    notebookCount: notesMetricsOk ? Number(nm.notebookCount ?? 0) : 0,
    audioDurationSecSum: worksMetricsOk ? Number(wm.audioDurationSecSum ?? 0) : 0,
    scriptCharCountSum: worksMetricsOk ? Number(wm.scriptCharCountSum ?? 0) : 0,
    activeJobsCount
  };

  return { works: merged, worksFetchErr, overview };
}
