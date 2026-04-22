/**
 * 作品封面 URL：外链封面常因防盗链无法在浏览器直接显示，走同源代理。
 */
export function workCoverImageSrc(url: string | undefined | null, cacheBust?: number): string {
  const u = String(url || "").trim();
  if (!u) return "";
  let base = u.startsWith("data:") || u.startsWith("/") ? u : `/api/image-proxy?url=${encodeURIComponent(u)}`;
  if (cacheBust && base.startsWith("/")) {
    base += `${base.includes("?") ? "&" : "?"}v=${cacheBust}`;
  }
  return base;
}

export function jobResultCoverUrl(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  return String(result.cover_image || result.coverImage || "").trim();
}
