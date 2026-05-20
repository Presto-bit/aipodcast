import type { ClipProjectRow } from "./clipTypes";

/** @deprecated 旧版 Shownotes 工程占位标题；新工程用 project_kind=shownotes + 音频文件名 */
export const SHOWNOTES_ONLY_CLIP_PROJECT_TITLE = "Shownotes";

export const CLIP_PROJECT_KIND_SHOWNOTES = "shownotes";
export const CLIP_PROJECT_KIND_CLIP = "clip";

export function isShownotesOnlyClipProject(
  p: Pick<ClipProjectRow, "title" | "project_kind"> | null | undefined
): boolean {
  if (!p) return false;
  const kind = String(p.project_kind || "").trim().toLowerCase();
  if (kind === CLIP_PROJECT_KIND_SHOWNOTES) return true;
  return String(p.title || "").trim() === SHOWNOTES_ONLY_CLIP_PROJECT_TITLE;
}

/** 列表展示名：优先工程标题（上传时的音频名），旧占位标题「Shownotes」回退到 audio_filename */
export function shownotesProjectDisplayTitle(p: ClipProjectRow | null | undefined): string {
  if (!p) return "未命名工程";
  const title = String(p.title || "").trim();
  if (title && title !== SHOWNOTES_ONLY_CLIP_PROJECT_TITLE) return title;
  const fn = String(p.audio_filename || "").trim();
  if (fn) return fn;
  const src = Array.isArray(p.audio_source_segments) ? p.audio_source_segments : [];
  const first = src[0]?.filename;
  if (first) return String(first).trim();
  return title || "未命名工程";
}

export function titleFromUploadedAudioFile(file: File): string {
  const name = (file.name || "").trim() || "audio";
  return name.slice(0, 200);
}

function pendingPipelineStorageKey(projectId: string): string {
  return `fym-shownotes-pending-pipeline-${encodeURIComponent(projectId)}`;
}

/** 用户已点击「开始生成」：刷新/切页后仍应在转写完成后自动跑标题与 Shownotes */
export function markShownotesPendingPipeline(projectId: string): void {
  try {
    sessionStorage.setItem(pendingPipelineStorageKey(projectId), "1");
  } catch {
    /* ignore */
  }
}

export function clearShownotesPendingPipeline(projectId: string): void {
  try {
    sessionStorage.removeItem(pendingPipelineStorageKey(projectId));
  } catch {
    /* ignore */
  }
}

export function hasShownotesPendingPipeline(projectId: string): boolean {
  try {
    return sessionStorage.getItem(pendingPipelineStorageKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function clipProjectHasMaterial(p: ClipProjectRow | null): boolean {
  if (!p) return false;
  if (p.has_material === true) return true;
  const merged = String(p.audio_object_key || "").trim();
  if (merged.length > 0) return true;
  const src = Array.isArray(p.audio_source_segments) ? p.audio_source_segments : [];
  if (src.length > 0) return true;
  const st = Array.isArray(p.audio_staging_keys) ? p.audio_staging_keys : [];
  if (st.length > 0) return true;
  return Boolean(p.has_audio) || Boolean(p.audio_download_url) || Boolean(p.audio_filename);
}

/** 与剪辑编辑器一致：合并主轨优先，否则单段素材直链 */
export function clipProjectMasterAudioSrc(projectId: string, p: ClipProjectRow): string | null {
  const pid = encodeURIComponent(projectId);
  const merged = String(p.audio_object_key || "").trim();
  if (merged.length > 0) return `/api/clip/projects/${pid}/audio/file`;
  const src = Array.isArray(p.audio_source_segments) && p.audio_source_segments.length > 0 ? p.audio_source_segments : [];
  const st = Array.isArray(p.audio_staging_keys) ? p.audio_staging_keys : [];
  const entries = src.length > 0 ? src : st;
  if (entries.length === 1) {
    const k = String(entries[0]?.key || "").trim();
    if (k) return `/api/clip/projects/${pid}/audio/source-segment/file?object_key=${encodeURIComponent(k)}`;
  }
  return null;
}
