import { coerceJobResult } from "./coerceJobResult";
import { ensureXhsTitles, platformLabel } from "./socialPublishPresets";
import { normalizeSocialImageSuggestions } from "./socialPublishImageSuggestions";
import type { SocialPublishCompliance, SocialPublishDraft, SocialPublishPlatform } from "./socialPublishTypes";

export type SocialPublishWorkDetail = SocialPublishDraft & {
  tags?: string[];
  interaction?: string;
};

/** 格式化为小红书正文末尾话题行（#标签） */
export function formatSocialPublishHashtagLine(tags: string[]): string {
  const parts: string[] = [];
  for (const raw of tags) {
    const tok = String(raw || "")
      .trim()
      .replace(/^#+/, "");
    if (tok) parts.push(`#${tok}`);
  }
  return parts.join(" ");
}

function bodyContainsHashtagLine(body: string, tags: string[]): boolean {
  const line = formatSocialPublishHashtagLine(tags);
  if (!line) return true;
  const trimmed = body.trim();
  if (trimmed.endsWith(line) || trimmed.includes(`\n${line}`)) return true;
  return tags.every((raw) => {
    const tok = String(raw || "")
      .trim()
      .replace(/^#+/, "");
    if (!tok) return true;
    return trimmed.includes(`#${tok}`);
  });
}

/**
 * 自媒体稿阅读正文：在 result.body 基础上补全未并入的话题标签与互动引导。
 */
export function buildSocialPublishManuscriptViewText(
  body: string,
  detail: Pick<SocialPublishWorkDetail, "tags" | "interaction">
): string {
  let text = String(body || "").trim();
  const tags = detail.tags ?? [];
  const tagLine = formatSocialPublishHashtagLine(tags);
  if (tagLine && !bodyContainsHashtagLine(text, tags)) {
    text = text ? `${text}\n\n${tagLine}` : tagLine;
  }
  const interaction = String(detail.interaction || "").trim();
  if (interaction && !text.includes(interaction)) {
    text = text ? `${text}\n\n${interaction}` : interaction;
  }
  return text;
}

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

  const payload = payloadRaw && typeof payloadRaw === "object" ? (payloadRaw as Record<string, unknown>) : {};
  const platRaw = String(result.platform || payload.platform || "xiaohongshu").trim();
  const platform: SocialPublishPlatform = platRaw === "wechat_mp" ? "wechat_mp" : "xiaohongshu";

  const titlesRaw = Array.isArray(result.titles)
    ? result.titles.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const fallback = String(result.cover_hook || result.title || "").trim();
  const titles = ensureXhsTitles(titlesRaw.length ? titlesRaw : fallback ? [fallback] : []);
  const theme = String(result.theme || "").trim();
  if (!body && !titles.some((t) => t.trim()) && !theme) return null;

  const imageRaw = result.imageSuggestions ?? result.image_suggestions ?? result.coverSuggestions;
  const imageSuggestions = normalizeSocialImageSuggestions(imageRaw, 8);

  const tagsRaw = result.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];
  const interaction = String(result.interaction || "").trim() || undefined;

  return {
    platform,
    titles,
    selectedTitleIndex: 0,
    coverHook: String(result.cover_hook || "").trim() || undefined,
    opening30: String(result.opening_30 ?? result.opening30 ?? "").trim() || undefined,
    theme,
    body,
    imageSuggestions,
    tags: tags.length ? tags : undefined,
    interaction,
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
