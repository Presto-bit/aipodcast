/**
 * 与作品详情页 SharePublishClient「生成中」进度条一致：时间估算 + 编排器 progress 取较大值，
 * 避免后端百分比跳动时单独依赖其一；列表卡片与详情共用此函数即可对齐。
 */

export function defaultJobGenEstimateSec(jobType: string): number {
  const j = String(jobType || "").toLowerCase();
  if (j.includes("short_video")) return 420;
  if (j === "script_draft") return 420;
  if (j === "social_publish_draft") return 600;
  return 540;
}

export type WorkHubGeneratingBarInput = {
  status: string;
  jobType: string;
  createdAt: string;
  startedAt?: string | null;
  /** 编排器 0–100；与前端估算条取 max */
  serverProgress?: number;
};

/** 返回 0–100，供进度条 width；非 queued/running 返回 0 */
export function computeWorkHubGeneratingBarPct(input: WorkHubGeneratingBarInput, nowMs: number = Date.now()): number {
  const st = String(input.status || "").trim();
  if (st !== "queued" && st !== "running") return 0;
  const estimateSec = defaultJobGenEstimateSec(input.jobType);
  const startedMs = input.startedAt ? Date.parse(String(input.startedAt)) : NaN;
  const createdMs = Date.parse(String(input.createdAt || ""));
  const t0 = Number.isFinite(startedMs)
    ? startedMs
    : Number.isFinite(createdMs)
      ? createdMs
      : nowMs;
  const elapsedSec = Math.max(0, (nowMs - t0) / 1000);
  const queued = st === "queued";
  const synthetic = queued
    ? Math.min(12, (elapsedSec / 120) * 12)
    : Math.min(94, (elapsedSec / estimateSec) * 100);
  const sp =
    typeof input.serverProgress === "number" && Number.isFinite(input.serverProgress)
      ? Math.max(0, Math.min(100, input.serverProgress))
      : 0;
  return Math.min(100, Math.max(synthetic, sp));
}
