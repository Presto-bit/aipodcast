import { normalizeHexForMp3 } from "./audioHex";
import { unusableInsecureHttpOnHttpsPage } from "./insecureHttpOnHttpsPage";
import { getBearerAuthHeadersSync } from "./authHeaders";
import { coerceJobResult } from "./coerceJobResult";
import { resolveJobScriptBodyText } from "./jobScriptText";

export type JobBundleExportOptions = {
  jobId: string;
  title: string;
  /** ID3 艺人（TPE1） */
  exportArtist?: string;
  /** ID3 专辑（TALB） */
  exportAlbum?: string;
  /** 嵌入 ID3 章节（需任务含 audio_chapters）；默认 true */
  embedChaptersInMp3?: boolean;
  /** 写入压缩包内的 shownotes.md */
  showNotesMarkdown?: string;
};

export function sanitizeFolderName(title: string): string {
  const t = String(title || "").trim() || "作品";
  const noCtrl = t
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 ? "_" : ch;
    })
    .join("");
  const cleaned = noCtrl.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "作品";
}

function hexToUint8Array(hex: string): Uint8Array {
  const c = normalizeHexForMp3(hex);
  if (!c || c.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(c)) return new Uint8Array();
  const out = new Uint8Array(c.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function summarizeUrlForLog(url: string, maxLen = 120): string {
  const u = String(url || "").trim();
  if (!u) return "(empty)";
  try {
    const parsed = new URL(u, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    const q = parsed.search ? "?…" : "";
    const path = `${parsed.origin}${parsed.pathname}${q}`;
    return path.length <= maxLen ? path : `${path.slice(0, maxLen)}…`;
  } catch {
    return u.length <= maxLen ? u : `${u.slice(0, maxLen)}…`;
  }
}

export type BundleAudioResolveAttempt = {
  step: string;
  ok: boolean;
  status?: number;
  detail?: string;
};

function mimeToCoverExt(mime: string): string {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "jpg";
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

/** 区分「HTTP 成功但正文实为 JSON 错误页」与真实 MP3（成片已剥离 audio_hex 时仅依赖此路径）。 */
function isLikelyMp3Bytes(buf: Uint8Array): boolean {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  const n = Math.min(buf.length - 1, 4096);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

function appendRequestIdHint(detail: string, requestId: string): string {
  const d = String(detail || "").trim();
  const rid = String(requestId || "").trim();
  if (!rid) return d;
  if (/request[_-]?id/i.test(d)) return d;
  return `${d}（request_id: ${rid}）`;
}

function detailFromMaybeJsonBodyBytes(buf: Uint8Array, httpStatus: number, requestId: string): string {
  try {
    const asText = new TextDecoder().decode(buf.slice(0, 1200)).trim();
    if (asText.startsWith("{")) {
      const j = JSON.parse(asText) as { detail?: unknown; error?: unknown; request_id?: unknown; requestId?: unknown };
      const d = j.detail != null ? String(j.detail) : j.error != null ? String(j.error) : "";
      const rid = String(j.request_id ?? j.requestId ?? requestId ?? "").trim();
      if (d) return appendRequestIdHint(d.slice(0, 280), rid);
    }
    if (asText) return appendRequestIdHint(asText.slice(0, 280), requestId);
  } catch {
    // ignore
  }
  return appendRequestIdHint(`HTTP ${httpStatus}`, requestId);
}

async function fetchJobAudioExportBytes(
  jobId: string,
  authHdr: Record<string, string>,
  body: {
    title: string;
    artist: string;
    album: string;
    embed_chapters: boolean;
  }
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number; detail: string }> {
  const jid = encodeURIComponent(jobId);
  try {
    const res = await fetch(`/api/jobs/${jid}/audio-export`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHdr },
      body: JSON.stringify(body)
    });
    const rid = (res.headers.get("x-request-id") || "").trim();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) {
      return { ok: false, status: res.status, detail: detailFromMaybeJsonBodyBytes(buf, res.status, rid) };
    }
    if (!isLikelyMp3Bytes(buf)) {
      let asText = "";
      try {
        asText = new TextDecoder().decode(buf.slice(0, 400));
      } catch {
        asText = "";
      }
      const hint = asText.trim().startsWith("{") ? asText.trim().slice(0, 200) : "响应不是有效的 MP3";
      const withRid = appendRequestIdHint(hint, rid);
      return { ok: false, status: res.status, detail: withRid };
    }
    return { ok: true, bytes: buf };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : "网络错误"
    };
  }
}

async function fetchBytesFromAudioUrl(url: string, authHdr: Record<string, string>): Promise<Uint8Array | null> {
  const u = String(url || "").trim();
  if (!u) return null;
  if (typeof window !== "undefined" && unusableInsecureHttpOnHttpsPage(u)) {
    return null;
  }
  try {
    const relative = u.startsWith("/");
    const sameOrigin =
      relative ||
      (typeof window !== "undefined" && (u.startsWith(window.location.origin + "/") || u.startsWith(window.location.origin + "?")));
    const res = await fetch(u, {
      credentials: sameOrigin ? "same-origin" : "omit",
      mode: "cors",
      headers: sameOrigin ? { ...authHdr } : {}
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return isLikelyMp3Bytes(buf) ? buf : null;
  } catch {
    return null;
  }
}

function resultSuggestsAudioPresent(result: Record<string, unknown>, hex: string): boolean {
  if (String(hex || "").trim()) return true;
  if (String(result.audio_object_key || "").trim()) return true;
  if (String(result.audio_url || "").trim()) return true;
  const durRaw = result.audio_duration_sec;
  if (typeof durRaw === "number" && Number.isFinite(durRaw) && durRaw > 0.4) return true;
  if (typeof durRaw === "string" && durRaw.trim()) {
    const d = Number.parseFloat(durRaw);
    if (Number.isFinite(d) && d > 0.4) return true;
  }
  if (result.has_audio_hex === true) return true;
  return false;
}

/**
 * 依次尝试：带章节的导出 → 无章节导出 → hex → result.audio_url（预签名直链等）。
 */
async function resolveBundleMp3Bytes(
  jobId: string,
  authHdr: Record<string, string>,
  result: Record<string, unknown>,
  hex: string,
  exportBody: { title: string; artist: string; album: string; wantChapters: boolean }
): Promise<{ bytes: Uint8Array; lastError: string; attempts: BundleAudioResolveAttempt[] }> {
  const attempts: BundleAudioResolveAttempt[] = [];
  let lastError = "";
  const tryExport = async (embedChapters: boolean) => {
    const r = await fetchJobAudioExportBytes(jobId, authHdr, {
      title: exportBody.title,
      artist: exportBody.artist,
      album: exportBody.album,
      embed_chapters: embedChapters
    });
    attempts.push({
      step: `POST /api/jobs/…/audio-export embed_chapters=${embedChapters}`,
      ok: r.ok,
      status: r.ok ? undefined : r.status,
      detail: r.ok ? `${r.bytes.length} bytes (mp3)` : r.detail
    });
    if (r.ok) {
      lastError = "";
      return r.bytes;
    }
    lastError = r.detail || `HTTP ${r.status}`;
    return null;
  };

  let bytes =
    (await tryExport(exportBody.wantChapters)) ||
    (exportBody.wantChapters ? await tryExport(false) : null);

  if (!bytes || bytes.length === 0) {
    const fromHex = hex ? hexToUint8Array(hex) : new Uint8Array();
    const hexOk = fromHex.length > 0;
    attempts.push({
      step: "fallback audio_hex decode",
      ok: hexOk,
      detail: hexOk ? `${fromHex.length} bytes` : hex ? `invalid_or_empty_hex (len ${hex.length})` : "no_hex_in_result"
    });
    if (hexOk) {
      bytes = fromHex;
      lastError = "";
    }
  }

  if (!bytes || bytes.length === 0) {
    const rawUrl = String(result.audio_url || "").trim();
    const fromUrl = await fetchBytesFromAudioUrl(rawUrl, authHdr);
    const urlOk = Boolean(fromUrl && fromUrl.length > 0);
    attempts.push({
      step: "fallback result.audio_url fetch",
      ok: urlOk,
      detail: urlOk
        ? `${fromUrl!.length} bytes (mp3)`
        : rawUrl
          ? `no_valid_mp3_from ${summarizeUrlForLog(rawUrl)}`
          : "no_audio_url_in_result"
    });
    if (urlOk) {
      bytes = fromUrl!;
      lastError = "";
    }
  }

  return { bytes: bytes || new Uint8Array(), lastError, attempts };
}

function summarizeAudioAttemptsForUser(attempts: BundleAudioResolveAttempt[], maxLen = 380): string {
  const failed = attempts.filter((a) => !a.ok);
  if (failed.length === 0) return "";
  const parts = failed.map((a) => {
    const shortStep = a.step.includes("audio-export")
      ? "导出MP3"
      : a.step.includes("audio_hex")
        ? "内置hex"
        : a.step.includes("audio_url")
          ? "外链拉取"
          : a.step.slice(0, 40);
    const st = a.status != null && a.status > 0 ? ` HTTP ${a.status}` : "";
    const det = a.detail ? ` ${String(a.detail).replace(/\s+/g, " ").slice(0, 96)}` : "";
    return `${shortStep}${st}${det}`;
  });
  const s = parts.join("；");
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

type ManuscriptParts = { introT: string; scriptBody: string; outroT: string };

async function loadJobManuscriptParts(jobId: string): Promise<{
  authHdr: Record<string, string>;
  result: Record<string, unknown>;
  hex: string;
  parts: ManuscriptParts;
}> {
  const authHdr = getBearerAuthHeadersSync();
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHdr }
  });
  const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const d = row.detail;
    const err = row.error;
    let snippet = "";
    if (typeof d === "string" && d.trim()) snippet = d.trim();
    else if (d != null && typeof d !== "object") snippet = String(d).trim();
    else if (typeof err === "string" && err.trim()) snippet = err.trim();
    else if (err != null && typeof err !== "object") snippet = String(err).trim();
    throw new Error(
      snippet
        ? `获取作品数据失败（HTTP ${res.status}）：${snippet.slice(0, 280)}`
        : `获取作品数据失败（HTTP ${res.status}）`
    );
  }
  const result = coerceJobResult(row.result);
  const scriptBody = await resolveJobScriptBodyText(jobId, row, authHdr);
  const introT = String(result.tts_intro_text || "").trim();
  const outroT = String(result.tts_outro_text || "").trim();
  const hex = normalizeHexForMp3(String(result.audio_hex || ""));
  return { authHdr, result, hex, parts: { introT, scriptBody, outroT } };
}

function formatManuscriptPlainZip(parts: ManuscriptParts): string {
  const { introT, scriptBody, outroT } = parts;
  let scriptDoc = "";
  if (introT) scriptDoc += `【开场】\n${introT}\n\n`;
  if (scriptBody) scriptDoc += `【正文】\n${scriptBody}\n\n`;
  if (outroT) scriptDoc += `【结尾】\n${outroT}\n`;
  return scriptDoc.trim() || scriptBody;
}

/** 文章类直链下载：默认 Markdown，含开场/正文/结尾时用二级标题分段。 */
function formatManuscriptMarkdown(parts: ManuscriptParts): string {
  const { introT, scriptBody, outroT } = parts;
  const blocks: string[] = [];
  if (introT) blocks.push(`## 开场\n\n${introT}`);
  if (scriptBody) {
    if (introT || outroT) blocks.push(`## 正文\n\n${scriptBody.trimEnd()}`);
    else blocks.push(scriptBody.trimEnd());
  }
  if (outroT) blocks.push(`## 结尾\n\n${outroT}`);
  const merged = blocks.join("\n\n").trim();
  return merged || scriptBody.trim();
}

export type JobManuscriptDownloadOptions = Pick<JobBundleExportOptions, "jobId" | "title">;

/**
 * 仅下载文稿为单个 `.md` 文件（不打 ZIP）。用于 script_draft / 文章类作品。
 */
export async function downloadJobManuscriptMarkdown(opts: JobManuscriptDownloadOptions): Promise<void> {
  const { parts } = await loadJobManuscriptParts(opts.jobId);
  const md = formatManuscriptMarkdown(parts);
  if (!md) {
    throw new Error("文稿为空，无法下载");
  }
  const nameBase = sanitizeFolderName(opts.title);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${nameBase}.md`);
}

/**
 * 从任务结果拉取音频 / 文稿 / 封面，打 ZIP。
 * 音频默认经服务端写入 ID3（标题、艺人、专辑）与可选章节；失败时回退为原始 hex 解码。
 */
export async function downloadJobBundleZip(opts: JobBundleExportOptions): Promise<void> {
  try {
    await downloadJobBundleZipImpl(opts);
  } catch (e) {
    throw e;
  }
}

async function downloadJobBundleZipImpl(opts: JobBundleExportOptions): Promise<void> {
  const { authHdr, result, hex, parts } = await loadJobManuscriptParts(opts.jobId);
  const script = formatManuscriptPlainZip(parts);
  const coverUrl = String(result.cover_image || result.coverImage || "").trim();
  const folderName = sanitizeFolderName(opts.title);
  const embedChapters = opts.embedChaptersInMp3 !== false;

  const { bytes: resolvedAudio, lastError: audioResolveError, attempts: audioResolveAttempts } =
    await resolveBundleMp3Bytes(
      opts.jobId,
      authHdr,
      result,
      hex,
      {
        title: (opts.title || folderName).slice(0, 300),
        artist: (opts.exportArtist || "").trim(),
        album: (opts.exportAlbum || "").trim(),
        wantChapters: embedChapters
      }
    );
  const audioBytes = Uint8Array.from(resolvedAudio);

  const likelyHasEpisodeAudio = resultSuggestsAudioPresent(result, hex);
  if (likelyHasEpisodeAudio && audioBytes.length === 0) {
    const attemptLine = summarizeAudioAttemptsForUser(audioResolveAttempts);
    const base =
      audioResolveError.trim()
        ? `无法打包音频：${audioResolveError.trim()}`
        : "无法打包音频：服务端导出不可用，且文稿以外的回退来源均未返回有效 MP3。请稍后重试。";
    throw new Error(attemptLine ? `${base}（已尝试：${attemptLine}）` : base);
  }

  const hasAudio = audioBytes.length > 0;
  const hasScript = Boolean(script);
  const hasCover = Boolean(coverUrl);
  const notesMd = String(opts.showNotesMarkdown || "").trim();
  const hasNotes = Boolean(notesMd);
  if (!hasAudio && !hasScript && !hasCover && !hasNotes) {
    throw new Error("任务中没有可打包内容（音频/文稿/封面/Show notes 均为空）");
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(folderName);
  if (!root) throw new Error("无法创建压缩包");

  if (hasAudio) {
    root.file("音频.mp3", audioBytes);
  }

  if (script) {
    root.file("文稿.txt", script);
  }

  if (hasNotes) {
    root.file("shownotes.md", notesMd);
  }

  if (coverUrl) {
    try {
      const sameOriginCover = coverUrl.startsWith("/api/jobs/") && coverUrl.includes("/cover");
      const coverFetchUrl = sameOriginCover
        ? coverUrl
        : `/api/image-proxy?url=${encodeURIComponent(coverUrl)}`;
      let imgRes = await fetch(coverFetchUrl, { credentials: "same-origin", headers: { ...authHdr } });
      if (!imgRes.ok && !sameOriginCover) {
        imgRes = await fetch(coverUrl, { mode: "cors", credentials: "omit" });
      }
      if (imgRes.ok) {
        const coverBlob = await imgRes.blob();
        const ext = mimeToCoverExt(coverBlob.type);
        root.file(`封面.${ext}`, coverBlob);
      }
    } catch {
      // 封面拉取失败时仅打包其余文件
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(blob, `${folderName}.zip`);
}
