import type { JobRecord } from "./types";

/** 与用户可见「进行中」列表一致：排除后台 note_rag_index 等内部任务 */
export function isUserVisibleActiveJob(job: Pick<JobRecord, "job_type">): boolean {
  return String(job.job_type || "").trim() !== "note_rag_index";
}

export function countUserVisibleActiveJobs(jobs: JobRecord[] | undefined): number {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter((j) => isUserVisibleActiveJob(j)).length;
}
