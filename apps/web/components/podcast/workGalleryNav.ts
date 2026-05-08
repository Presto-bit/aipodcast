/** 作品详情链接：与 PodcastWorksGallery / 分享页一致 */
export function buildWorkDetailHref(jobId: string, opts?: { returnTo?: string; tabPublish?: boolean }) {
  const q = new URLSearchParams();
  if (opts?.returnTo) q.set("returnTo", opts.returnTo);
  if (opts?.tabPublish) q.set("tab", "publish");
  const s = q.toString();
  return `/works/${encodeURIComponent(jobId)}${s ? `?${s}` : ""}`;
}
