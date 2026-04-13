/**
 * 对外展示的 RSS 节目源根域名（含协议）。
 * 部署到其它域名时可在环境变量中覆盖。
 */
export const RSS_PUBLIC_BASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_RSS_PUBLIC_BASE_URL?.trim()) || "https://www.prestoai.cn";

/** 站点对外 origin（与 RSS 公网域名一致），用于分享页等需「可转发域名链接」的场景 */
export function publicSiteOrigin(): string {
  try {
    return new URL(RSS_PUBLIC_BASE_URL).origin;
  } catch {
    return "";
  }
}

/** 作品分享页完整 URL（优先使用公网域名，而非本地或内网 origin） */
export function buildWorksSharePageUrl(jobId: string): string {
  const id = String(jobId || "").trim();
  const o = publicSiteOrigin();
  if (!id || !o) return "";
  return `${o.replace(/\/$/, "")}/works/share/${encodeURIComponent(id)}`;
}

export function rssFeedUrlForSlug(feedSlug: string): string {
  const slug = String(feedSlug || "").trim();
  if (!slug) return "";
  const base = RSS_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/api/rss/feed/${slug}`;
}
