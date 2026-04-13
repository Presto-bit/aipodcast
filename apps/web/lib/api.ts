import { getBearerAuthHeadersSync } from "./authHeaders";
import { JobRecord, JobStatus } from "./types";

function authMerge(headers?: Record<string, string>): Record<string, string> {
  return { ...getBearerAuthHeadersSync(), ...(headers || {}) };
}

/** 同步解析编排器常见 JSON 错误体（FastAPI detail 字符串等） */
export function formatOrchestratorErrorText(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as { detail?: unknown; error?: unknown; message?: unknown };
      const d = j.detail ?? j.error ?? j.message;
      if (d != null && String(d).trim()) return String(d);
    } catch {
      /* 非 JSON */
    }
  }
  return trimmed;
}

/** 将失败响应体解析为人类可读文案（优先 FastAPI detail / JSON error） */
async function errorMessageFromResponse(resp: Response): Promise<string> {
  const text = await resp.text();
  const trimmed = formatOrchestratorErrorText(text);
  if (trimmed) return trimmed;
  return text.trim() || `请求失败 ${resp.status}`;
}

/** 携带 HTTP 状态，便于调用方区分 404（已删除）与其它错误 */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export type MediaJobPreviewResult = {
  success?: boolean;
  media_wallet_billing_enabled?: boolean;
  allowed?: boolean;
  detail?: string;
  summary?: string;
  estimated_spoken_minutes?: number;
  wallet_charge_cents?: number;
  wallet_balance_cents?: number;
  tier?: string;
  job_type?: string;
};

/** 创建播客/TTS 前预估口播分钟与钱包扣费（与 POST /api/jobs 计费前置条件一致） */
export async function previewMediaJob(payload: {
  project_name: string;
  job_type: string;
  queue_name: "ai" | "media";
  payload: Record<string, unknown>;
  created_by?: string | null;
}): Promise<MediaJobPreviewResult> {
  const body: Record<string, unknown> = {
    project_name: payload.project_name,
    job_type: payload.job_type,
    queue_name: payload.queue_name,
    payload: payload.payload
  };
  const cb = (payload.created_by || "").trim();
  if (cb) body.created_by = cb;
  const resp = await fetch("/api/jobs/preview-media", {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || `预估请求失败 ${resp.status}`);
  }
  return JSON.parse(text) as MediaJobPreviewResult;
}

export async function createJob(payload: {
  project_name: string;
  job_type: string;
  queue_name: "ai" | "media";
  payload: Record<string, unknown>;
  /** 与 orchestrator 任务 created_by 对齐，用于套餐限制（笔记引用等） */
  created_by?: string | null;
}) {
  const body: Record<string, unknown> = {
    project_name: payload.project_name,
    job_type: payload.job_type,
    queue_name: payload.queue_name,
    payload: payload.payload
  };
  const cb = (payload.created_by || "").trim();
  if (cb) body.created_by = cb;

  const resp = await fetch("/api/jobs", {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const rawErr = await resp.text();
  if (!resp.ok) throw new Error(formatOrchestratorErrorText(rawErr) || rawErr || `创建任务失败 ${resp.status}`);
  return (await resp.json()) as JobRecord;
}

export async function getJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}`, { cache: "no-store", headers: authMerge() });
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()) as JobRecord;
}

export async function listJobs(params?: {
  limit?: number;
  offset?: number;
  /** 单一状态，或多个用逗号连接，如 queued,running */
  status?: JobStatus | "" | string;
  /** 默认 true；进行中摘要需要 payload 时请传 false */
  slim?: boolean;
}) {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  if (params?.status) sp.set("status", params.status);
  sp.set("slim", params?.slim === false ? "0" : "1");
  const q = sp.toString();
  const resp = await fetch(`/api/jobs${q ? `?${q}` : ""}`, { cache: "no-store", headers: authMerge() });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  const data = (await resp.json()) as {
    success?: boolean;
    jobs?: JobRecord[];
    has_more?: boolean;
    offset?: number;
  };
  return {
    jobs: data.jobs ?? [],
    hasMore: Boolean(data.has_more),
    offset: typeof data.offset === "number" ? data.offset : 0
  };
}

export async function cancelJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}`, {
    method: "POST",
    credentials: "same-origin",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()) as Record<string, unknown>;
}

/** 软删除任务（进回收站），与创作记录 / 作品列表行为一致 */
export async function deleteJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  // 使用 POST 别名，避免部分环境对 DELETE 的异常处理（与 BFF 注释一致）
  const resp = await fetch(`/api/jobs/${id}/delete`, {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  return (await resp.json()) as Record<string, unknown>;
}

/**
 * 硬删任务行与存储。回收站条目可直接 purge；排队/执行中也可直接 purge（「没跑完的」列表）。
 * 使用 POST，避免部分环境对 DELETE 的处理问题。
 */
export async function purgeJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}/purge`, {
    method: "POST",
    credentials: "same-origin",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!resp.ok) {
    const message = await errorMessageFromResponse(resp);
    throw new HttpStatusError(resp.status, message);
  }
  return (await resp.json()) as Record<string, unknown>;
}

export async function retryJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}/retry`, {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()) as JobRecord;
}

export type RssChannel = {
  id: string;
  feed_slug: string;
  title: string;
  description?: string;
  author?: string;
  language?: string;
  image_url?: string;
};

export type RssPublication = {
  channel_id: string;
  channel_title: string;
  feed_slug: string;
  episode_id: string;
  title: string;
  published_at: string;
};

export async function listRssChannels(): Promise<RssChannel[]> {
  const resp = await fetch("/api/rss/channels", { cache: "no-store", headers: authMerge() });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  const data = (await resp.json()) as { channels?: RssChannel[] };
  return Array.isArray(data.channels) ? data.channels : [];
}

export async function upsertRssChannel(payload: {
  title: string;
  description?: string;
  author?: string;
  language?: string;
  image_url?: string;
}): Promise<RssChannel> {
  const resp = await fetch("/api/rss/channels", {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  const data = (await resp.json()) as { channel?: RssChannel };
  if (!data.channel) throw new Error("保存发布设置失败");
  return data.channel;
}

export async function publishWorkToRss(payload: {
  channel_id: string;
  job_id: string;
  title: string;
  summary?: string;
  show_notes?: string;
  explicit?: boolean;
  publish_at?: string;
  force_republish?: boolean;
}) {
  const resp = await fetch("/api/rss/publish", {
    method: "POST",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  return (await resp.json()) as { success?: boolean; episode_id?: string; guid?: string };
}

export async function listRssPublicationsByJobIds(jobIds: string[]) {
  const ids = jobIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (ids.length === 0) return {} as Record<string, RssPublication[]>;
  const q = new URLSearchParams({ job_ids: ids.join(",") }).toString();
  const resp = await fetch(`/api/rss/publications?${q}`, { cache: "no-store", headers: authMerge() });
  if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
  const data = (await resp.json()) as { items?: Record<string, RssPublication[]> };
  return data.items || {};
}
