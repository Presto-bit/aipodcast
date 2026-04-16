/**
 * Fetch / RequestInit 要求 header 值为 ISO-8859-1；中文文件名须用 UTF-8 百分号编码后再放入自定义头。
 * 与 BFF、编排器侧 decode 成对使用。
 */
const MAX_RAW_CHARS = 200;

export function encodeClipFilenameForHttpHeader(filename: string, fallback: string): string {
  const raw = (filename || fallback).trim().slice(0, MAX_RAW_CHARS) || fallback;
  return encodeURIComponent(raw);
}

export function decodeClipFilenameHeader(encoded: string, fallback: string): string {
  const s = (encoded || fallback).trim() || fallback;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
