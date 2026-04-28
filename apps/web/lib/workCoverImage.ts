/**
 * 作品封面 URL：外链封面常因防盗链无法在浏览器直接显示，走同源代理。
 */
export function workCoverImageSrc(
  url: string | undefined | null,
  cacheBust?: number,
  stableJobId?: string
): string {
  const u = String(url || "").trim();
  if (!u) return "";
  const jobId = String(stableJobId || "").trim();
  let base = "";
  if (u.startsWith("data:") || u.startsWith("/")) {
    base = u;
  } else if (jobId) {
    // 使用稳定同源地址作为缓存键，避免外链签名 URL 变化导致刷新后重复拉图。
    base = `/api/jobs/${encodeURIComponent(jobId)}/cover`;
  } else {
    base = `/api/image-proxy?url=${encodeURIComponent(u)}`;
  }
  if (cacheBust && base.startsWith("/")) {
    base += `${base.includes("?") ? "&" : "?"}v=${cacheBust}`;
  }
  return base;
}

export function jobResultCoverUrl(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  return String(result.cover_image || result.coverImage || "").trim();
}
