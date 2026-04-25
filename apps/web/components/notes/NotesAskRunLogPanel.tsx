"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getNotesAskClientLogSnapshot,
  subscribeNotesAskClientLog,
  type NotesAskClientLogChannel,
  type NotesAskClientLogEntry,
  type NotesAskClientLogLevel
} from "../../lib/notesAskClientLog";

const DIALOG_CHANNELS = new Set<NotesAskClientLogChannel>(["hints", "stream"]);

const DISPLAY_CAP = 100;

function levelClass(level: NotesAskClientLogLevel): string {
  if (level === "error") return "text-danger-ink";
  if (level === "warn") return "text-amber-800 dark:text-amber-200";
  if (level === "info") return "text-ink/90";
  return "text-muted";
}

function formatClock(iso: string): string {
  const s = (iso || "").trim();
  if (s.length >= 19 && s[4] === "-" && s[7] === "-") {
    return s.slice(11, 23);
  }
  return s.slice(11, 23) || "—";
}

function detailOneLine(d: Record<string, unknown> | undefined): string {
  if (!d || !Object.keys(d).length) return "";
  try {
    return JSON.stringify(d);
  } catch {
    return "";
  }
}

export function NotesAskRunLogPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotesAskClientLogEntry[]>(() =>
    getNotesAskClientLogSnapshot().filter((e) => DIALOG_CHANNELS.has(e.channel))
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeNotesAskClientLog((entry) => {
      if (!DIALOG_CHANNELS.has(entry.channel)) return;
      setRows((prev) => {
        const next = [...prev, entry];
        if (next.length > DISPLAY_CAP) next.splice(0, next.length - DISPLAY_CAP);
        return next;
      });
    });
  }, []);

  const resyncFromBuffer = useCallback(() => {
    setRows(
      getNotesAskClientLogSnapshot()
        .filter((e) => DIALOG_CHANNELS.has(e.channel))
        .slice(-DISPLAY_CAP)
    );
  }, []);

  useEffect(() => {
    if (open) resyncFromBuffer();
  }, [open, resyncFromBuffer]);

  const copyJson = useCallback(async () => {
    const snap = getNotesAskClientLogSnapshot().filter((e) => DIALOG_CHANNELS.has(e.channel));
    try {
      await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 权限拒绝时静默
    }
  }, []);

  const summary = useMemo(() => {
    const n = rows.length;
    if (n === 0) return "暂无记录";
    const last = rows[n - 1]!;
    return `最近 ${n} 条 · 末条 ${last.event}`;
  }, [rows]);

  return (
    <div className="shrink-0 rounded-xl border border-line/70 bg-fill/30 text-[11px] leading-snug">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-ink hover:bg-fill/60"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="notes-ask-run-log-body"
      >
        <span className="min-w-0 font-medium">
          运行日志
          <span className="ml-1.5 font-normal text-muted">（导读 hints / 流式 stream · 对齐 x-request-id）</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="max-w-[10rem] truncate text-muted" title={summary}>
            {summary}
          </span>
          <span className="text-muted" aria-hidden>
            {open ? "▲" : "▼"}
          </span>
        </span>
      </button>
      {open ? (
        <div id="notes-ask-run-log-body" className="border-t border-line/50 px-2 pb-2 pt-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[10px] hover:bg-fill"
              onClick={() => resyncFromBuffer()}
            >
              从缓冲刷新
            </button>
            <button
              type="button"
              className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[10px] hover:bg-fill"
              onClick={() => void copyJson()}
            >
              {copied ? "已复制 JSON" : "复制全部 JSON"}
            </button>
            <span className="text-[10px] text-muted">控制台也可执行 __FYM_NOTES_ASK_LOG_EXPORT__()</span>
          </div>
          <div
            className="max-h-40 overflow-y-auto rounded-lg border border-line/40 bg-surface/90 px-2 py-1.5 font-mono text-[10px]"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {rows.length === 0 ? (
              <p className="text-muted">发起导读或提问后，此处会显示请求阶段、HTTP 状态、SSE 等关键节点。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {rows.map((e, i) => (
                  <li key={`${e.t}-${e.channel}-${e.event}-${i}`} className="break-all">
                    <span className="tabular-nums text-muted">{formatClock(e.iso)}</span>{" "}
                    <span className="text-muted">[{e.channel}]</span>{" "}
                    <span className={levelClass(e.level)}>{e.level}</span> <span className="text-ink">{e.event}</span>
                    {e.detail && Object.keys(e.detail).length ? (
                      <span className="block pl-0 text-muted opacity-90">{detailOneLine(e.detail)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
