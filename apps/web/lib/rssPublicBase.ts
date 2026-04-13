/**
 * 对外展示的 RSS 节目源根域名（含协议）。
 * 部署到其它域名时可在环境变量中覆盖。
 */
export const RSS_PUBLIC_BASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_RSS_PUBLIC_BASE_URL?.trim()) || "https://www.prestoai.cn";

export function rssFeedUrlForSlug(feedSlug: string): string {
  const slug = String(feedSlug || "").trim();
  if (!slug) return "";
  const base = RSS_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/api/rss/feed/${slug}`;
}
