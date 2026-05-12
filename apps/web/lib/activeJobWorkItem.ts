import { summarizeActiveJobPayload } from "./jobPayloadSummary";
import type { JobRecord } from "./types";
import type { WorkItem } from "./worksTypes";
import { jobResultCoverUrl } from "./workCoverImage";

/**
 * 将队列中的 JobRecord 转为「我的作品」画廊用的 WorkItem（与成品列表字段对齐，缺省处由卡片占位）。
 */
export function activeJobRecordToWorkItem(job: JobRecord): WorkItem {
  const { headline, detail } = summarizeActiveJobPayload(job);
  const type = String(job.job_type || "").trim() || "podcast_generate";
  const result = (job.result || {}) as Record<string, unknown>;
  const cover = jobResultCoverUrl(result);
  const pct = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
  return {
    id: String(job.id),
    type,
    title: headline,
    createdAt: job.created_at,
    status: job.status,
    downloadAllowed: false,
    coverImage: cover || undefined,
    audioDurationSec: null,
    activeJobSummary: detail,
    activeJobProgress: pct,
    activeJobStartedAt: job.started_at ?? null
  };
}
