export type WorkCoverImageSrcOptions = {
  /** 列表卡片：编排器按最大边生成缩略图（query `w`），减轻带宽与解码 */
  listMaxWidth?: number;
};

export const WORK_COVER_PLACEHOLDER_SRC = "/brand/cover-placeholder.svg";

/**
 * 作品封面 URL：外链封面常因防盗链无法在浏览器直接显示，走同源代理。
 */
export function workCoverImageSrc(
  url: string | undefined | null,
  cacheBust?: number,
  stableJobId?: string,
  options?: WorkCoverImageSrcOptions
): string {
  const u = String(url || "").trim();
  if (!u) return "";
  const jobId = String(stableJobId || "").trim();
  let base = "";
  if (u.startsWith("data:")) {
    base = u;
  } else if (/^https?:\/\//i.test(u)) {
    // 外链封面走 image-proxy；勿在有 jobId 时强行打 /cover（多数作品未持久化 cover_object_key）
    base = `/api/image-proxy?url=${encodeURIComponent(u)}`;
  } else if (u.startsWith("/api/jobs/") && u.includes("/cover")) {
    base = u;
  } else if (u.startsWith("/")) {
    base = u;
  } else if (jobId) {
    base = `/api/jobs/${encodeURIComponent(jobId)}/cover`;
  } else {
    return "";
  }
  const lw = options?.listMaxWidth;
  if (lw != null && Number.isFinite(lw) && lw >= 64 && lw <= 1200 && base.includes("/api/jobs/") && base.includes("/cover")) {
    const n = Math.floor(lw);
    base += `${base.includes("?") ? "&" : "?"}w=${n}`;
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

/**
 * 封面 `<img>` 加载失败时的回退：image-proxy → 外链直链 → 占位图 → 隐藏。
 */
export function handleWorkCoverImageError(
  el: HTMLImageElement,
  originalUrl: string | undefined | null,
  unusableInsecureHttp?: (url: string) => boolean
): void {
  const orig = String(originalUrl || "").trim();
  const src = el.src;

  if (orig && src.includes("/api/image-proxy") && !el.dataset.fallbackDirect) {
    el.dataset.fallbackDirect = "1";
    if (!unusableInsecureHttp?.(orig)) {
      el.src = orig;
      return;
    }
  }

  if (
    orig &&
    src.includes("/api/jobs/") &&
    src.includes("/cover") &&
    !el.dataset.fallbackProxy &&
    (orig.startsWith("http://") || orig.startsWith("https://"))
  ) {
    el.dataset.fallbackProxy = "1";
    el.src = `/api/image-proxy?url=${encodeURIComponent(orig)}`;
    return;
  }

  if (!el.dataset.fallbackPlaceholder && WORK_COVER_PLACEHOLDER_SRC) {
    el.dataset.fallbackPlaceholder = "1";
    el.src = WORK_COVER_PLACEHOLDER_SRC;
    el.style.display = "";
    return;
  }

  el.style.display = "none";
}
