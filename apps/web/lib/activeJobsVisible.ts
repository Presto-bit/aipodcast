import type { JobRecord } from "./types";

const HIDDEN_ACTIVE_JOB_TYPES = new Set(["note_rag_index", "note_style_features"]);

/** 与用户可见「进行中」列表一致：排除后台索引/风格特征等内部任务 */
export function isUserVisibleActiveJob(job: Pick<JobRecord, "job_type">): boolean {
  return !HIDDEN_ACTIVE_JOB_TYPES.has(String(job.job_type || "").trim());
}

export function countUserVisibleActiveJobs(jobs: JobRecord[] | undefined): number {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter((j) => isUserVisibleActiveJob(j)).length;
}
