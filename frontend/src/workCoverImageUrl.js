import { apiPath, resolveMediaUrl } from './apiBaseUrl';

/**
 * 作品卡片封面图地址：相对路径走 API 基址；外链走后端代理，避免防盗链/CORS 导致 <img> 裂图。
 */
export function getWorkCoverSrc(coverRaw) {
  const u = String(coverRaw ?? '').trim();
  if (!u || u === 'null' || u === 'undefined') return '';
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return apiPath(`/download/cover?url=${encodeURIComponent(u)}`);
  }
  return resolveMediaUrl(u);
}
