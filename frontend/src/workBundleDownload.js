import JSZip from 'jszip';
import { resolveMediaUrl } from './apiBaseUrl';
import { getWorkCoverSrc } from './workCoverImageUrl';

/**
 * 将作品标题整理为安全的 ZIP 内文件夹名（解压后一层目录）。
 */
export function sanitizeFolderName(title) {
  const t = String(title || '').trim() || '作品';
  const noCtrl = t
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32) return '_';
      return ch;
    })
    .join('');
  const cleaned = noCtrl.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || '作品';
}

function mimeToCoverExt(mime) {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'jpg';
}

function audioInnerName(blob, audioFullUrl) {
  if (blob?.type?.includes('wav')) return '音频.wav';
  try {
    const u = audioFullUrl.startsWith('http') ? new URL(audioFullUrl) : new URL(audioFullUrl, window.location.origin);
    const seg = (u.pathname.split('/').filter(Boolean).pop() || '').split('?')[0];
    const m = seg.match(/\.(mp3|wav|m4a|ogg)$/i);
    if (m) return `音频${m[0].toLowerCase()}`;
  } catch {
    // ignore
  }
  return '音频.mp3';
}

async function fetchBlob(url, headers) {
  const res = await fetch(url, { mode: 'cors', headers: { ...headers } });
  if (!res.ok) throw new Error(`下载失败：${url}（HTTP ${res.status}）`);
  return res.blob();
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

/**
 * 将音频、文稿、封面打成一个 ZIP；解压后为一个以标题命名的文件夹，内含 音频.*、文稿.txt、封面.*（有则加入）。
 *
 * @param {object} opts
 * @param {string} opts.title - 作品标题（用作文件夹名与 zip 文件名）
 * @param {string} opts.audioUrl - 音频相对或绝对 URL（必填）
 * @param {string} [opts.scriptText] - 文稿正文（优先）
 * @param {string} [opts.scriptUrl] - 无正文时从此 URL 拉取文稿
 * @param {string} [opts.coverRaw] - 封面原始字段（与页面展示一致）
 * @param {() => Record<string,string>} [opts.getAuthHeaders]
 */
export async function downloadWorkBundleZip({
  title,
  audioUrl,
  scriptText,
  scriptUrl,
  coverRaw,
  getAuthHeaders = () => ({}),
}) {
  const headers = getAuthHeaders();
  const folderName = sanitizeFolderName(title);
  const zip = new JSZip();
  const root = zip.folder(folderName);
  if (!root) throw new Error('无法创建压缩包');

  if (!audioUrl) {
    throw new Error('没有可下载的音频');
  }

  const audioFull = resolveMediaUrl(audioUrl);
  const audioBlob = await fetchBlob(audioFull, headers);
  root.file(audioInnerName(audioBlob, audioFull), audioBlob);

  let script = String(scriptText || '').trim();
  if (!script && scriptUrl) {
    const res = await fetch(resolveMediaUrl(scriptUrl), { headers });
    if (res.ok) script = String(await res.text()).trim();
  }
  if (script) {
    root.file('文稿.txt', script);
  }

  const coverUrl = getWorkCoverSrc(coverRaw);
  if (coverUrl) {
    try {
      const coverBlob = await fetchBlob(coverUrl, headers);
      const ext = mimeToCoverExt(coverBlob.type);
      root.file(`封面.${ext}`, coverBlob);
    } catch {
      // 封面失败不阻断整包（已有音频+文稿）
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, `${folderName}.zip`);
}
