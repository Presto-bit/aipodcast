"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getNotesAskClientLogSnapshot,
  subscribeNotesAskClientLog,
  type NotesAskClientLogChannel,
  type NotesAskClientLogEntry,
  type NotesAskClientLogLevel
} from "../../lib/notesAskClientLog";

const DIALOG_CHANNELS = new Set<NotesAskClientLogChannel>(["stream"]);

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

type RunSummary = {
  requestId: string;
  startedAtIso: string;
  startedAtMs: number;
  status: "running" | "completed" | "incomplete" | "failed";
  noteCount: number | null;
  questionLen: number | null;
  httpStatus: number | null;
  ttfbMs: number | null;
  ttfChunkMs: number | null;
  streamMs: number | null;
  totalMs: number | null;
  chunkCount: number | null;
  chunkChars: number | null;
  lastEvent: string;
};

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function briefMs(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}

function levelByStatus(status: RunSummary["status"]): string {
  if (status === "completed") return "text-success-ink";
  if (status === "incomplete") return "text-amber-700 dark:text-amber-200";
  if (status === "failed") return "text-danger-ink";
  return "text-info-ink";
}

function labelByStatus(status: RunSummary["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "incomplete") return "未完整结束";
  if (status === "failed") return "失败";
  return "进行中";
}

function buildRunSummaries(rows: NotesAskClientLogEntry[]): RunSummary[] {
  const map = new Map<string, RunSummary>();
  for (const e of rows) {
    const rid = asString(e.detail?.requestId).trim();
    if (!rid) continue;
    const cur =
      map.get(rid) ||
      ({
        requestId: rid,
        startedAtIso: e.iso,
        startedAtMs: e.t,
        status: "running",
        noteCount: null,
        questionLen: null,
        httpStatus: null,
        ttfbMs: null,
        ttfChunkMs: null,
        streamMs: null,
        totalMs: null,
        chunkCount: null,
        chunkChars: null,
        lastEvent: e.event
      } satisfies RunSummary);
    if (e.t < cur.startedAtMs) {
      cur.startedAtMs = e.t;
      cur.startedAtIso = e.iso;
    }
    cur.lastEvent = e.event;
    if (e.event === "request_start") {
      cur.noteCount = asNumber(e.detail?.noteCount);
      cur.questionLen = asNumber(e.detail?.questionLen);
    } else if (e.event === "fetch_resolved") {
      cur.httpStatus = asNumber(e.detail?.httpStatus);
      cur.ttfbMs = asNumber(e.detail?.ms);
    } else if (e.event === "first_chunk") {
      cur.ttfChunkMs = asNumber(e.detail?.ttfChunkMs);
    } else if (e.event === "sse_completed") {
      cur.status = "completed";
      cur.totalMs = asNumber(e.detail?.totalMs);
      cur.streamMs = asNumber(e.detail?.streamMs);
      cur.chunkCount = asNumber(e.detail?.chunkCount);
      cur.chunkChars = asNumber(e.detail?.chunkChars);
      const ttfb = asNumber(e.detail?.ttfbMs);
      if (ttfb != null) cur.ttfbMs = ttfb;
      const ttfChunk = asNumber(e.detail?.ttfChunkMs);
      if (ttfChunk != null) cur.ttfChunkMs = ttfChunk;
    } else if (e.event === "incomplete_no_done_event") {
      cur.status = "incomplete";
      cur.totalMs = asNumber(e.detail?.totalMs);
      cur.chunkCount = asNumber(e.detail?.chunkCount);
      cur.chunkChars = asNumber(e.detail?.chunkChars);
    } else if (e.event === "request_failed") {
      cur.status = "failed";
    } else if (e.event === "request_finished") {
      const st = asString(e.detail?.outcome);
      if (st === "completed" || st === "incomplete" || st === "failed") cur.status = st;
      const totalMs = asNumber(e.detail?.totalMs);
      if (totalMs != null) cur.totalMs = totalMs;
      const ttfbMs = asNumber(e.detail?.ttfbMs);
      if (ttfbMs != null) cur.ttfbMs = ttfbMs;
      const ttfChunkMs = asNumber(e.detail?.ttfChunkMs);
      if (ttfChunkMs != null) cur.ttfChunkMs = ttfChunkMs;
      const chunkCount = asNumber(e.detail?.chunkCount);
      if (chunkCount != null) cur.chunkCount = chunkCount;
      const chunkChars = asNumber(e.detail?.chunkChars);
      if (chunkChars != null) cur.chunkChars = chunkChars;
    }
    map.set(rid, cur);
  }
  return [...map.values()].sort((a, b) => b.startedAtMs - a.startedAtMs);
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
  const runs = useMemo(() => buildRunSummaries(rows), [rows]);

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
          <span className="ml-1.5 font-normal text-muted">（流式 stream · 对齐 x-request-id）</span>
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
          <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-line/40 bg-surface/90 p-2 text-[10px]">
            {runs.length === 0 ? (
              <p className="text-muted">暂无请求汇总；发起提问后会按 requestId 展示各阶段耗时。</p>
            ) : (
              runs.slice(0, 10).map((run) => (
                <div key={run.requestId} className="rounded-md border border-line/40 bg-fill/40 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{formatClock(run.startedAtIso)}</span>
                    <span className={`font-medium ${levelByStatus(run.status)}`}>{labelByStatus(run.status)}</span>
                  </div>
                  <p className="mt-0.5 break-all text-muted">rid: {run.requestId}</p>
                  <p className="mt-0.5 text-ink/90">
                    TTFB {briefMs(run.ttfbMs)} · 首字 {briefMs(run.ttfChunkMs)} · 流式 {briefMs(run.streamMs)} · 总计{" "}
                    {briefMs(run.totalMs)}
                  </p>
                  <p className="mt-0.5 text-muted">
                    分块 {run.chunkCount ?? "—"} / 字符 {run.chunkChars ?? "—"} / HTTP {run.httpStatus ?? "—"} / 来源{" "}
                    {run.noteCount ?? "—"} 条 / 问题 {run.questionLen ?? "—"} 字
                  </p>
                </div>
              ))
            )}
          </div>
          <div
            className="max-h-40 overflow-y-auto rounded-lg border border-line/40 bg-surface/90 px-2 py-1.5 font-mono text-[10px]"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {rows.length === 0 ? (
              <p className="text-muted">发起提问后，此处会显示请求阶段、HTTP 状态、SSE 等关键节点。</p>
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
