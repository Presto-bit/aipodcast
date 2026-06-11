/** 营销站根 URL（PrestoAI 品牌外链）；未配置时与 RSS 公网默认一致 */
export function marketingSiteUrl(): string {
  const u = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim()) || "";
  return u || "https://prestoai.cn";
}

/** 营销站绝对路径（如 `/podcast` → `https://prestoai.cn/podcast`） */
export function marketingSitePath(path: string): string {
  const base = marketingSiteUrl().replace(/\/$/, "");
  const segment = String(path || "").trim();
  if (!segment) return base;
  return segment.startsWith("/") ? `${base}${segment}` : `${base}/${segment}`;
}

/** 侧栏「播客」→ 营销站播客页 */
export function marketingPodcastHref(): string {
  return marketingSitePath("/podcast");
}

/** 侧栏「语音合成」→ 营销站 TTS 页 */
export function marketingPodcastTtsHref(): string {
  return marketingSitePath("/podcast/tts");
}
