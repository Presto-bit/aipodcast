import type { ClipProjectRow } from "./clipTypes";

export function clipProjectHasMaterial(p: ClipProjectRow | null): boolean {
  if (!p) return false;
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
