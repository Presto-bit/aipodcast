import type { ShareFormFields } from "../../../lib/sharePublishDefaults";

export function sanitizeWorkDetailReturnTo(raw: string | null | undefined, fallback: string): string {
  const t = String(raw ?? "").trim();
  if (!t.startsWith("/") || t.startsWith("//")) return fallback;
  if (t.includes(":")) return fallback;
  const qIdx = t.indexOf("?");
  const pathOnly = (qIdx >= 0 ? t.slice(0, qIdx) : t).split("#")[0] || "";
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return fallback;
  if (pathOnly.includes(":")) return fallback;
  if (qIdx < 0) return pathOnly || fallback;
  const queryOnly = t.slice(qIdx + 1).split("#")[0] ?? "";
  if (!queryOnly) return pathOnly || fallback;
  if (queryOnly.length > 512) return pathOnly || fallback;
  if (!/^[a-zA-Z0-9_.=&%-]+$/.test(queryOnly)) return pathOnly || fallback;
  return `${pathOnly}?${queryOnly}`;
}

/** 成片可能只有对象存储 URL / key，不一定内联 audio_hex（大文件会省略 hex）。 */
export function jobResultHasPlayableAudio(result: Record<string, unknown>): boolean {
  const hex = String(result.audio_hex || "").trim();
  const url = String(result.audio_url || "").trim();
  const key = String(result.audio_object_key || "").trim();
  const durRaw = result.audio_duration_sec;
  let dur = 0;
  if (typeof durRaw === "number" && Number.isFinite(durRaw)) dur = durRaw;
  else if (typeof durRaw === "string" && durRaw.trim()) dur = Number.parseFloat(durRaw);
  return Boolean(hex || url || key || (Number.isFinite(dur) && dur > 0.4));
}

export type FormSnapshot = ShareFormFields;

export type ShareGenContext = {
  payload: Record<string, unknown>;
  displayTitleHint: string;
  titleFallbackRaw: string;
  resultEarly: Record<string, unknown>;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function defaultScheduleDatetimeLocal(): string {
  const d = new Date();
  d.setMilliseconds(0);
  d.setSeconds(0, 0);
  d.setMinutes(0, 0);
  d.setHours(d.getHours() + 1);
  return toDatetimeLocalValue(d);
}

export function formatSchedulePreview(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

export function formatListenClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatEtaRoughCn(sec: number): string {
  const s = Math.ceil(Math.max(0, sec));
  if (s < 90) return `${s} 秒`;
  const m = Math.max(1, Math.round(s / 60));
  return `${m} 分钟`;
}
