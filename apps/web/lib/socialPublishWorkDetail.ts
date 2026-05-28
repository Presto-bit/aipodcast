import { coerceJobResult } from "./coerceJobResult";
import { ensureXhsTitles, platformLabel } from "./socialPublishPresets";
import type { SocialPublishCompliance, SocialPublishDraft, SocialPublishPlatform } from "./socialPublishTypes";

export type SocialPublishWorkDetail = SocialPublishDraft & {
  tags?: string[];
};

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

/** 从任务 result（及可选 payload）解析自媒体发布稿，供作品详情展示与复制 */
export function parseSocialPublishWorkDetail(
  resultRaw: unknown,
  payloadRaw?: unknown
): SocialPublishWorkDetail | null {
  const result = coerceJobResult(resultRaw);
  const body = String(result.body || "").trim();
  if (!body) return null;

  const payload = payloadRaw && typeof payloadRaw === "object" ? (payloadRaw as Record<string, unknown>) : {};
  const platRaw = String(result.platform || payload.platform || "xiaohongshu").trim();
  const platform: SocialPublishPlatform = platRaw === "wechat_mp" ? "wechat_mp" : "xiaohongshu";

  const titlesRaw = Array.isArray(result.titles)
    ? result.titles.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const fallback = String(result.cover_hook || result.title || "").trim();
  const titles = ensureXhsTitles(titlesRaw.length ? titlesRaw : fallback ? [fallback] : []);

  const imageRaw = result.imageSuggestions ?? result.image_suggestions ?? result.coverSuggestions;
  const imageSuggestions = Array.isArray(imageRaw)
    ? imageRaw.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];

  const tagsRaw = result.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];

  return {
    platform,
    titles,
    selectedTitleIndex: 0,
    coverHook: String(result.cover_hook || "").trim() || undefined,
    opening30: String(result.opening_30 ?? result.opening30 ?? "").trim() || undefined,
    theme: String(result.theme || "").trim(),
    body,
    imageSuggestions,
    tags: tags.length ? tags : undefined,
    compliance: parseCompliance(result)
  };
}

export function socialPublishDisplayTitle(detail: SocialPublishWorkDetail): string {
  return (
    detail.titles[detail.selectedTitleIndex]?.trim() ||
    detail.titles[0]?.trim() ||
    detail.coverHook?.trim() ||
    `${platformLabel(detail.platform)}发布稿`
  );
}
