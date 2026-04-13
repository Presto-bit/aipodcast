import JSZip from "jszip";
import { getBearerAuthHeadersSync } from "./authHeaders";
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
  const c = hex.trim();
  if (!c || c.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(c.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

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

async function fetchTaggedMp3Bytes(
  jobId: string,
  authHdr: Record<string, string>,
  body: {
    title: string;
    artist: string;
    album: string;
    embed_chapters: boolean;
  }
): Promise<Uint8Array | null> {
  const jid = encodeURIComponent(jobId);
  try {
    const res = await fetch(`/api/jobs/${jid}/audio-export`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHdr },
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * 从任务结果拉取音频 / 文稿 / 封面，打 ZIP。
 * 音频默认经服务端写入 ID3（标题、艺人、专辑）与可选章节；失败时回退为原始 hex 解码。
 */
export async function downloadJobBundleZip(opts: JobBundleExportOptions): Promise<void> {
  const authHdr = getBearerAuthHeadersSync();
  const res = await fetch(`/api/jobs/${opts.jobId}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHdr }
  });
  const row = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (row as { detail?: string }).detail;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const result = (row.result || {}) as Record<string, unknown>;
  const hex = String(result.audio_hex || "").trim();
  const scriptBody = await resolveJobScriptBodyText(opts.jobId, row, authHdr);
  const introT = String(result.tts_intro_text || "").trim();
  const outroT = String(result.tts_outro_text || "").trim();
  let scriptDoc = "";
  if (introT) scriptDoc += `【开场】\n${introT}\n\n`;
  if (scriptBody) scriptDoc += `【正文】\n${scriptBody}\n\n`;
  if (outroT) scriptDoc += `【结尾】\n${outroT}\n`;
  const script = scriptDoc.trim() || scriptBody;
  const coverUrl = String(result.cover_image || result.coverImage || "").trim();
  const folderName = sanitizeFolderName(opts.title);
  const embedChapters = opts.embedChaptersInMp3 !== false;

  const taggedMp3 =
    hex &&
    (await fetchTaggedMp3Bytes(opts.jobId, authHdr, {
      title: (opts.title || folderName).slice(0, 300),
      artist: (opts.exportArtist || "").trim(),
      album: (opts.exportAlbum || "").trim(),
      embed_chapters: embedChapters
    }));
  const fallbackMp3 = hex ? hexToUint8Array(hex) : new Uint8Array();
  const audioBytes = taggedMp3 && taggedMp3.length > 0 ? Uint8Array.from(taggedMp3) : fallbackMp3;

  const hasAudio = audioBytes.length > 0;
  const hasScript = Boolean(script);
  const hasCover = Boolean(coverUrl);
  const notesMd = String(opts.showNotesMarkdown || "").trim();
  const hasNotes = Boolean(notesMd);
  if (!hasAudio && !hasScript && !hasCover && !hasNotes) {
    throw new Error("任务中没有可打包内容（音频/文稿/封面/Show notes 均为空）");
  }

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
      const proxied = `/api/image-proxy?url=${encodeURIComponent(coverUrl)}`;
      let imgRes = await fetch(proxied, { credentials: "same-origin", headers: { ...authHdr } });
      if (!imgRes.ok) {
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
