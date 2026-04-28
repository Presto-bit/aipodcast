"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT,
  readNotebookShareFailureHistory,
  readNotebookShareLastError,
  type ShareFailureEntry,
  type ShareLastErrorPayload
} from "../../lib/notebookShareDiagnostics";

/**
 * 首页最上方：与知识库页共用 localStorage，展示最近一次笔记本分享失败与历史记录。
 */
export default function NotebookShareDiagnosticsHomeBanner() {
  const [last, setLast] = useState<ShareLastErrorPayload | null>(null);
  const [history, setHistory] = useState<ShareFailureEntry[]>([]);

  const refresh = useCallback(() => {
    setLast(readNotebookShareLastError());
    setHistory(readNotebookShareFailureHistory());
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key.includes("notes:share-last-error") ||
        e.key.includes("notes:share-failure-history") ||
        e.key.includes("notes:share-last-error:fallback")
      ) {
        refresh();
      }
    };
    const onCustom = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT, onCustom as EventListener);
    };
  }, [refresh]);

  if (!last && history.length === 0) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-warning/40 bg-warning-soft/30 p-3 sm:p-4"
      role="region"
      aria-label="知识库笔记本分享失败诊断"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-semibold text-warning-ink sm:text-sm">知识库 · 笔记本分享失败（诊断已同步到首页）</p>
        <Link
          href="/notes"
          className="shrink-0 rounded border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill"
        >
          去知识库
        </Link>
      </div>
      {last ? (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft/15 p-2">
          <p className="text-[11px] font-medium text-danger-ink">
            最近一次：{last.notebook || "未知笔记本"}
            {last.at ? ` · ${last.at.replace("T", " ").slice(0, 19)}` : ""}
          </p>
          {last.error ? <p className="mt-1 text-[11px] text-danger-ink">{last.error}</p> : null}
          <pre className="mt-2 max-h-48 overflow-auto rounded border border-line/60 bg-fill/30 p-2 text-[10px] leading-relaxed text-muted">
            {last.debugLog}
          </pre>
        </div>
      ) : null}
      {history.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-ink">失败历史（{history.length} 条）</p>
          <div className="mt-2 max-h-[min(40vh,18rem)] space-y-2 overflow-y-auto pr-1">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg border border-line/70 bg-fill/25 p-2">
                <p className="text-[10px] text-ink">
                  [{item.mode === "share" ? "分享" : "取消"}] {item.notebook} ·{" "}
                  {item.at ? item.at.replace("T", " ").slice(0, 19) : "-"}
                </p>
                {item.error ? <p className="mt-0.5 text-[10px] text-danger-ink">{item.error}</p> : null}
                <pre className="mt-1 max-h-32 overflow-auto text-[9px] leading-relaxed text-muted">{item.debugLog}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
