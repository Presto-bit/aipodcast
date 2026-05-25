import { apiErrorMessage } from "./apiError";
import { ensureXhsTitles } from "./socialPublishPresets";
import type {
  SocialPublishCompliance,
  SocialPublishDraft,
  SocialPublishPlatform
} from "./socialPublishTypes";

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

function mapContentDraft(
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
  const imageSuggestions = Array.isArray(imageRaw)
    ? imageRaw.map((t) => String(t).trim()).filter(Boolean)
    : [];
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

export async function fetchSocialPublishDraft(params: {
  platform: SocialPublishPlatform;
  materialText: string;
  options: Record<string, unknown>;
  sourceType: string;
  authHeaders: Record<string, string>;
}): Promise<SocialPublishDraft> {
  const res = await fetch("/api/social/publish-draft", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...params.authHeaders },
    body: JSON.stringify({
      platform: params.platform,
      material_text: params.materialText,
      options: params.options,
      source_type: params.sourceType
    })
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success === false) {
    throw new Error(apiErrorMessage(data, "生成发布稿失败"));
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
