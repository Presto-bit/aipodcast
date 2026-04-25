/**
 * 知识库「向资料提问」前端排障日志：内存环形缓冲 + window 导出，便于对照 BFF/编排器 x-request-id。
 * 生产默认不写控制台；在浏览器控制台执行 `copy(JSON.stringify(window.__FYM_NOTES_ASK_LOG__))` 可导出最近条目。
 * 构建时设 NEXT_PUBLIC_NOTES_ASK_CLIENT_LOG=1 可在生产镜像里同步 mirror 到 console。
 */

export type NotesAskClientLogLevel = "debug" | "info" | "warn" | "error";

export type NotesAskClientLogChannel = "hints" | "stream" | "persist" | "ui";

export type NotesAskClientLogEntry = {
  t: number;
  iso: string;
  level: NotesAskClientLogLevel;
  channel: NotesAskClientLogChannel;
  event: string;
  detail?: Record<string, unknown>;
};

const MAX = 160;
const buffer: NotesAskClientLogEntry[] = [];

type NotesAskClientLogListener = (entry: NotesAskClientLogEntry) => void;
const listeners = new Set<NotesAskClientLogListener>();

/** 订阅新日志（仅客户端）；返回取消订阅函数 */
export function subscribeNotesAskClientLog(fn: NotesAskClientLogListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyListeners(entry: NotesAskClientLogEntry): void {
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // 避免面板回调抛错影响主流程
    }
  }
}

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(truncated,len=${s.length})`;
}

function sanitizeDetail(d: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!d || !Object.keys(d).length) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v == null) {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = truncateStr(v, 2400);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 40);
    } else if (typeof v === "object") {
      try {
        out[k] = truncateStr(JSON.stringify(v), 1200);
      } catch {
        out[k] = "[object]";
      }
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function mirrorConsole(entry: NotesAskClientLogEntry): void {
  const line = `[fym-notes-ask][${entry.channel}][${entry.level}] ${entry.event}`;
  const detail = entry.detail;
  const fn =
    entry.level === "error"
      ? console.error
      : entry.level === "warn"
        ? console.warn
        : entry.level === "info"
          ? console.info
          : console.debug;
  if (detail && Object.keys(detail).length) fn(line, detail);
  else fn(line);
}

function shouldMirrorToConsole(): boolean {
  if (typeof process !== "undefined" && String(process.env.NEXT_PUBLIC_NOTES_ASK_CLIENT_LOG || "").trim() === "1") {
    return true;
  }
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") return true;
  return false;
}

/** 写入一条日志；detail 内长字符串会被截断 */
export function notesAskClientLog(
  level: NotesAskClientLogLevel,
  channel: NotesAskClientLogChannel,
  event: string,
  detail?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const entry: NotesAskClientLogEntry = {
    t: Date.now(),
    iso: new Date().toISOString(),
    level,
    channel,
    event,
    ...(() => {
      const d = sanitizeDetail(detail);
      return d ? { detail: d } : {};
    })()
  };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  notifyListeners(entry);

  const w = window as unknown as {
    __FYM_NOTES_ASK_LOG__?: NotesAskClientLogEntry[];
    __FYM_NOTES_ASK_LOG_EXPORT__?: () => string;
  };
  w.__FYM_NOTES_ASK_LOG__ = buffer;
  w.__FYM_NOTES_ASK_LOG_EXPORT__ = () => JSON.stringify(buffer, null, 2);

  if (shouldMirrorToConsole()) mirrorConsole(entry);
}

export function getNotesAskClientLogSnapshot(): NotesAskClientLogEntry[] {
  return [...buffer];
}
