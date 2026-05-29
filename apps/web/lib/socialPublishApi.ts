import { apiErrorMessage } from "./apiError";
import { createJob } from "./api";
import { buildSocialPublishReferenceBody } from "./socialPublishReference";
import { normalizeSocialImageSuggestions } from "./socialPublishImageSuggestions";
import { NOTES_PODCAST_PROJECT_NAME } from "./notesProject";
import type {
  SocialPublishCompliance,
  SocialPublishDraft,
  SocialPublishPlatform
} from "./socialPublishTypes";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 20 * 60 * 1000;

function parseCompliance(data: Record<string, unknown>): SocialPublishCompliance | undefined {
  const c = data.compliance;
  if (!c || typeof c !== "object") return undefined;
  const row = c as Record<string, unknown>;
  const status = row.status === "auto_softened" ? "auto_softened" : "passed";
  return {
    status,
    hitCount: Number(row.hit_count ?? row.hitCount ?? 0) || 0,
    categories: Array.isArray(row.categories) ? row.categories.map((x) => String(x)) : [],
    userMessage: String(row.user_message ?? row.userMessage ?? "").trim() || "可直接复制发布"
  };
}

export function mapContentDraft(
  data: Record<string, unknown>,
  platform: SocialPublishPlatform
): SocialPublishDraft {
  const titlesRaw = Array.isArray(data.titles)
    ? data.titles.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const fallback = String(data.cover_hook || data.title || "笔记标题").trim();
  const titles = ensureXhsTitles(titlesRaw.length ? titlesRaw : fallback ? [fallback] : []);
  const opening30 = String(data.opening_30 ?? data.opening30 ?? "").trim();
  const body = String(data.body || "").trim();
  const imageRaw = data.imageSuggestions ?? data.image_suggestions ?? data.coverSuggestions;
  const imageSuggestions = normalizeSocialImageSuggestions(imageRaw, 8);
  return {
    platform,
    titles,
    selectedTitleIndex: 0,
    coverHook: String(data.cover_hook || "").trim() || undefined,
    opening30: opening30 || undefined,
    theme: String(data.theme || ""),
    body,
    imageSuggestions,
    compliance: parseCompliance(data)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJobRow(jobId: string, authHeaders: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHeaders }
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, `查询任务失败（HTTP ${res.status}）`));
  }
  return data;
}

/** 轮询已有任务直至终态（与生成文章一致，不占用长连接） */
export async function waitForSocialPublishJob(params: {
  jobId: string;
  platform: SocialPublishPlatform;
  authHeaders: Record<string, string>;
  onProgress?: (message: string, progress?: number) => void;
}): Promise<SocialPublishDraft> {
  const jobId = String(params.jobId || "").trim();
  if (!jobId) throw new Error("任务编号无效");

  const deadline = Date.now() + POLL_MAX_MS;
  let lastMsg = "";

  while (Date.now() < deadline) {
    const row = await fetchJobRow(jobId, params.authHeaders);
    const st = String(row.status || "").trim();
    const progress = typeof row.progress === "number" ? row.progress : undefined;

    if (st === "succeeded") {
      const result = row.result;
      if (!result || typeof result !== "object") {
        throw new Error("任务已完成但未返回发布稿内容");
      }
      const platRaw = String((result as Record<string, unknown>).platform || params.platform);
      const plat: SocialPublishPlatform =
        platRaw === "wechat_mp" ? "wechat_mp" : "xiaohongshu";
      return mapContentDraft(result as Record<string, unknown>, plat);
    }
    if (st === "failed" || st === "cancelled") {
      const errMsg = String(row.error_message || "").trim();
      throw new Error(
        errMsg || (st === "cancelled" ? "任务已取消" : apiErrorMessage(row, "生成发布稿失败"))
      );
    }

    if (progress != null && progress >= 55) {
      lastMsg = "正在调用模型生成发布稿…";
    } else if (progress != null && progress >= 18) {
      lastMsg = "正在合并参考资料…";
    } else if (st === "queued") {
      lastMsg = "排队中，请稍候…";
    } else {
      lastMsg = "处理中…";
    }
    params.onProgress?.(lastMsg, progress);

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("生成超时：任务仍在后台执行，请稍后在笔记本「作品」区或「创作记录」查看");
}

/**
 * 与「生成文章」相同：创建 AI 队列任务并轮询，避免同步 HTTP 触发网关 504。
 */
export async function fetchSocialPublishDraft(params: {
  platform: SocialPublishPlatform;
  options: Record<string, unknown>;
  sourceType: string;
  authHeaders: Record<string, string>;
  selectedNoteIds: string[];
  selectedNoteTitles?: string[];
  notesSourceOwnerUserId?: string | null;
  notebookName?: string;
  createdBy?: string | null;
  onProgress?: (message: string, progress?: number) => void;
}): Promise<SocialPublishDraft> {
  const refBody = buildSocialPublishReferenceBody({
    selectedNoteIds: params.selectedNoteIds,
    selectedNoteTitles: params.selectedNoteTitles,
    notesSourceOwnerUserId: params.notesSourceOwnerUserId
  });
  const job = await createJob({
    project_name: NOTES_PODCAST_PROJECT_NAME,
    job_type: "social_publish_draft",
    queue_name: "ai",
    created_by: params.createdBy || undefined,
    payload: {
      platform: params.platform,
      options: params.options,
      source_type: params.sourceType,
      ...(params.notebookName?.trim() ? { notes_notebook: params.notebookName.trim() } : {}),
      ...refBody
    }
  });
  const jobId = String(job.id || "").trim();
  if (!jobId) {
    throw new Error("创建发布稿任务失败：未返回任务编号");
  }

  params.onProgress?.("已提交云端队列，正在合并资料…", 10);

  return waitForSocialPublishJob({
    jobId,
    platform: params.platform,
    authHeaders: params.authHeaders,
    onProgress: params.onProgress
  });
}

/** @deprecated 同步接口保留给兼容；前端请使用 fetchSocialPublishDraft（异步任务） */
export async function fetchSocialPublishDraftSync(params: {
  platform: SocialPublishPlatform;
  options: Record<string, unknown>;
  sourceType: string;
  authHeaders: Record<string, string>;
  selectedNoteIds: string[];
  selectedNoteTitles?: string[];
  notesSourceOwnerUserId?: string | null;
}): Promise<SocialPublishDraft> {
  const res = await fetch("/api/social/publish-draft", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...params.authHeaders },
    body: JSON.stringify({
      platform: params.platform,
      options: params.options,
      source_type: params.sourceType,
      ...buildSocialPublishReferenceBody({
        selectedNoteIds: params.selectedNoteIds,
        selectedNoteTitles: params.selectedNoteTitles,
        notesSourceOwnerUserId: params.notesSourceOwnerUserId
      })
    })
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success === false) {
    if (res.status === 504 || res.status === 524) {
      throw new Error(
        "网关超时（504）：请改用异步生成（刷新页面后重试），或调大 Nginx/CDN 对 /api/social/ 的超时。"
      );
    }
    const msg = apiErrorMessage(data, "生成发布稿失败");
    const statusHint = !res.ok && msg === "生成发布稿失败" ? `（HTTP ${res.status}）` : "";
    throw new Error(`${msg}${statusHint}`);
  }
  return mapContentDraft(data, params.platform);
}

/** 播客成片：走 viral-copy（小红书同样经后台合规终稿） */
export async function fetchViralCopyForXhs(params: {
  sourceJobId: string;
  authHeaders: Record<string, string>;
}): Promise<SocialPublishDraft> {
  const res = await fetch("/api/social/viral-copy", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...params.authHeaders },
    body: JSON.stringify({ source_job_id: params.sourceJobId, platform: "xiaohongshu" })
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success === false) {
    throw new Error(apiErrorMessage(data, "生成小红书文案失败"));
  }
  if (Array.isArray(data.titles)) {
    return mapContentDraft(data, "xiaohongshu");
  }
  const title = String(data.title || "").trim();
  return mapContentDraft(
    {
      ...data,
      titles: title ? [title] : ["小红书笔记"],
      cover_hook: title
    },
    "xiaohongshu"
  );
}
