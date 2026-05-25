import { apiErrorMessage } from "./apiError";
import type { SocialPublishDraft, SocialPublishPlatform } from "./socialPublishTypes";

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
  if (params.platform === "xiaohongshu") {
    const titles = Array.isArray(data.titles) ? data.titles.map((t) => String(t).trim()).filter(Boolean) : [];
    return {
      platform: "xiaohongshu",
      titles: titles.length ? titles : [String(data.title || "笔记标题")],
      selectedTitleIndex: 0,
      theme: String(data.theme || ""),
      body: String(data.body || ""),
      tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      interaction: String(data.interaction || ""),
      coverSuggestions: Array.isArray(data.coverSuggestions)
        ? data.coverSuggestions.map((t) => String(t).trim()).filter(Boolean)
        : []
    };
  }
  return {
    platform: "wechat_mp",
    title: String(data.title || ""),
    digest: String(data.digest || ""),
    body: String(data.body || ""),
    cta: String(data.cta || "")
  };
}

/** 播客成片：优先走 viral-copy（已针对口播稿优化） */
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
  const title = String(data.title || "").trim();
  return {
    platform: "xiaohongshu",
    titles: title ? [title, `${title}（备选）`] : ["小红书笔记"],
    selectedTitleIndex: 0,
    theme: String(data.theme || ""),
    body: String(data.body || ""),
    tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    interaction: String(data.interaction || ""),
    coverSuggestions: []
  };
}
