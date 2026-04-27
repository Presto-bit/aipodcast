/**
 * 知识库「向资料提问」前端排障日志：内存环形缓冲 + window 导出，便于对照 BFF/编排器 x-request-id。
 * 默认不写控制台；在浏览器控制台执行 `copy(JSON.stringify(window.__FYM_NOTES_ASK_LOG__))` 可导出最近条目。
 * 仅当构建时设 NEXT_PUBLIC_NOTES_ASK_CLIENT_LOG=1 时才会 mirror 到 console（本地开发亦同）。
 */

import { createClientDebugRing, sanitizeClientLogDetail } from "./clientDebugRing";

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
const ring = createClientDebugRing<NotesAskClientLogEntry>(MAX);

type NotesAskClientLogListener = (entry: NotesAskClientLogEntry) => void;

/** 订阅新日志（仅客户端）；返回取消订阅函数 */
export function subscribeNotesAskClientLog(fn: NotesAskClientLogListener): () => void {
  return ring.subscribe(fn);
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
  return typeof process !== "undefined" && String(process.env.NEXT_PUBLIC_NOTES_ASK_CLIENT_LOG || "").trim() === "1";
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
      const d = sanitizeClientLogDetail(detail);
      return d ? { detail: d } : {};
    })()
  };
  ring.push(entry);

  const w = window as unknown as {
    __FYM_NOTES_ASK_LOG__?: NotesAskClientLogEntry[];
    __FYM_NOTES_ASK_LOG_EXPORT__?: () => string;
  };
  w.__FYM_NOTES_ASK_LOG__ = ring.liveRef();
  w.__FYM_NOTES_ASK_LOG_EXPORT__ = () => JSON.stringify(ring.liveRef(), null, 2);

  if (shouldMirrorToConsole()) mirrorConsole(entry);
}

export function getNotesAskClientLogSnapshot(): NotesAskClientLogEntry[] {
  return ring.snapshot();
}
