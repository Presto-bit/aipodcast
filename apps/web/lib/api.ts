import { getBearerAuthHeadersSync } from "./authHeaders";
import { humanizeUpstreamHtmlErrorBody } from "./apiError";
import { JobRecord, JobStatus } from "./types";

function authMerge(headers?: Record<string, string>): Record<string, string> {
  return { ...getBearerAuthHeadersSync(), ...(headers || {}) };
}

/** 同步解析编排器常见 JSON 错误体（FastAPI detail 字符串等） */
export function formatOrchestratorErrorText(rawText: string): string {
  const trimmed = rawText.trim();
  const htmlMsg = humanizeUpstreamHtmlErrorBody(trimmed);
  if (htmlMsg) return htmlMsg;
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
  /** 编排器预览：脚本文本上界（分） */
  wallet_text_charge_cents_preview?: number;
  /** 语音 + 文本预估合计（分） */
  wallet_total_charge_cents_preview?: number;
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
  /** 与 orchestrator 任务 created_by 对齐（笔记归属等） */
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
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || text || `创建任务失败 ${resp.status}`);
  }
  try {
    return JSON.parse(text) as JobRecord;
  } catch {
    throw new Error(text.trim() || "创建任务响应无效");
  }
}

export async function getJob(jobId: string) {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}`, { cache: "no-store", headers: authMerge() });
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()) as JobRecord;
}

/** 分享页匿名试听：无需登录；仅返回可播放 URL 与标题等安全字段 */
export type PublicShareListenPayload = {
  success: boolean;
  job_id: string;
  job_type: string;
  title: string;
  audio_url: string;
  audio_duration_sec?: number | null;
  preview?: string;
  /** 列表用短摘要（优先 auto_share_summary） */
  episode_summary?: string;
  /** RSS Shownotes 草稿（auto_share_show_notes） */
  show_notes?: string;
  cover_image?: string;
  audio_chapters?: Array<{ title: string; start_ms: number }>;
};

export async function fetchPublicShareListen(jobId: string): Promise<PublicShareListenPayload | null> {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}/share-public`, {
    cache: "no-store",
    credentials: "omit"
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(formatOrchestratorErrorText(t) || t || `share_public_failed_${resp.status}`);
  }
  const data = (await resp.json()) as PublicShareListenPayload;
  return data?.success && data.audio_url ? data : null;
}

/** 剪辑工程：与成片分享页同源管线生成 RSS Shownotes（generate_share_rss_ai_copy） */
export async function fetchClipProjectShareAiCopy(
  projectId: string,
  opts?: {
    showNotesOnly?: boolean;
    userPrompt?: string;
    baselineShowNotes?: string;
  }
): Promise<{
  success: boolean;
  summary?: string;
  show_notes?: string;
  trace_id?: string | null;
}> {
  const id = encodeURIComponent(String(projectId || "").trim());
  const body = JSON.stringify({
    show_notes_only: Boolean(opts?.showNotesOnly),
    user_prompt: opts?.userPrompt ?? "",
    baseline_show_notes: opts?.baselineShowNotes ?? ""
  });
  const resp = await fetch(`/api/clip/projects/${id}/share-ai-copy`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: authMerge({ "Content-Type": "application/json" }),
    body
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || `AI 生成失败 ${resp.status}`);
  }
  try {
    return JSON.parse(text) as {
      success: boolean;
      summary?: string;
      show_notes?: string;
      trace_id?: string | null;
    };
  } catch {
    throw new Error(text.trim() || "AI 生成响应无效");
  }
}

/** 将 Shownotes Markdown 写入剪辑工程（PATCH shownotes_markdown） */
export async function persistClipProjectShowNotes(projectId: string, showNotes: string): Promise<void> {
  const id = encodeURIComponent(String(projectId || "").trim());
  const res = await fetch(`/api/clip/projects/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify({ shownotes_markdown: String(showNotes ?? "") })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatOrchestratorErrorText(text) || `保存失败 ${res.status}`);
  }
  if (!text.trim()) return;
  try {
    const data = JSON.parse(text) as { success?: boolean };
    if (data.success === false) {
      throw new Error("保存未成功");
    }
  } catch (e) {
    if (e instanceof Error && e.message === "保存未成功") throw e;
    /* 200 但非标准 JSON 时仍视为已写入，避免误报保存失败 */
    return;
  }
}

/** Shownotes 制作页：基于转写稿生成 3 条节目标题候选 */
export async function fetchClipTitleSuggestions(projectId: string): Promise<{
  success: boolean;
  titles?: string[];
  trace_id?: string | null;
}> {
  const id = encodeURIComponent(String(projectId || "").trim());
  const resp = await fetch(`/api/clip/projects/${id}/title-suggestions`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: "{}"
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || `标题生成失败 ${resp.status}`);
  }
  try {
    return JSON.parse(text) as { success: boolean; titles?: string[]; trace_id?: string | null };
  } catch {
    throw new Error(text.trim() || "标题响应无效");
  }
}

/** 分享 / RSS：按服务端 TEXT_PROVIDER 生成简介与 Show Notes（Markdown）；或仅按提词重写 Shownotes */
export async function fetchJobShareAiCopy(
  jobId: string,
  opts?: {
    persist?: boolean;
    showNotesOnly?: boolean;
    userPrompt?: string;
    baselineShowNotes?: string;
  }
): Promise<{
  success: boolean;
  summary?: string;
  show_notes?: string;
  trace_id?: string | null;
  persisted?: boolean;
}> {
  const id = encodeURIComponent(String(jobId || "").trim());
  const body = JSON.stringify({
    persist: Boolean(opts?.persist),
    show_notes_only: Boolean(opts?.showNotesOnly),
    user_prompt: opts?.userPrompt ?? "",
    baseline_show_notes: opts?.baselineShowNotes ?? ""
  });
  const resp = await fetch(`/api/jobs/${id}/share-ai-copy`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: authMerge({ "Content-Type": "application/json" }),
    body
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || `AI 生成失败 ${resp.status}`);
  }
  try {
    return JSON.parse(text) as {
      success: boolean;
      summary?: string;
      show_notes?: string;
      trace_id?: string | null;
      persisted?: boolean;
    };
  } catch {
    throw new Error(text.trim() || "AI 生成响应无效");
  }
}

/** 将编辑区 Shownotes 写入 jobs.result.auto_share_show_notes（刷新后仍生效） */
export async function fetchPersistShareShowNotes(jobId: string, showNotes: string): Promise<void> {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/jobs/${id}/share-show-notes`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: authMerge({ "Content-Type": "application/json" }),
    body: JSON.stringify({ show_notes: showNotes })
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(formatOrchestratorErrorText(text) || text.trim() || `保存失败 ${resp.status}`);
  }
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
  /** 传入已有频道 id 为更新；省略则为新建 */
  id?: string;
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
  const ids = [...new Set(jobIds.map((x) => String(x || "").trim()).filter(Boolean))].sort();
  if (ids.length === 0) return {} as Record<string, RssPublication[]>;
  return fetchRssPublicationsByJobIdsDeduped(ids);
}

const rssPublicationsInflight = new Map<string, Promise<Record<string, RssPublication[]>>>();

/** 相同 job_ids 并发只发一次请求，避免作品列表轮询时打满浏览器连接池。 */
async function fetchRssPublicationsByJobIdsDeduped(
  sortedIds: string[]
): Promise<Record<string, RssPublication[]>> {
  const key = sortedIds.join(",");
  const pending = rssPublicationsInflight.get(key);
  if (pending) return pending;

  const q = new URLSearchParams({ job_ids: key }).toString();
  const request = (async () => {
    try {
      const resp = await fetch(`/api/rss/publications?${q}`, { cache: "no-store", headers: authMerge() });
      if (!resp.ok) throw new Error(await errorMessageFromResponse(resp));
      const data = (await resp.json()) as { items?: Record<string, RssPublication[]> };
      return data.items || {};
    } finally {
      rssPublicationsInflight.delete(key);
    }
  })();

  rssPublicationsInflight.set(key, request);
  return request;
}

export type RssPublishEligibilityResult = {
  success?: boolean;
  eligible?: boolean;
  detail?: string;
};

/** 与 POST /api/rss/publish 一致的预检：成片计费记录等（与订阅档位无关） */
export async function fetchRssPublishEligibility(jobId: string): Promise<RssPublishEligibilityResult> {
  const id = encodeURIComponent(String(jobId || "").trim());
  const resp = await fetch(`/api/rss/publish-eligibility?job_id=${id}`, {
    cache: "no-store",
    headers: authMerge()
  });
  const text = await resp.text();
  if (!resp.ok) {
    return { success: false, eligible: false, detail: formatOrchestratorErrorText(text) || `请求失败 ${resp.status}` };
  }
  try {
    return JSON.parse(text) as RssPublishEligibilityResult;
  } catch {
    return { success: false, eligible: false, detail: text || "响应无效" };
  }
}
