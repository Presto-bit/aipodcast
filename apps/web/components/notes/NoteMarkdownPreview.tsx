"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

const NoteMarkdownDoc = dynamic(() => import("./NoteMarkdownDoc"), {
  ssr: false,
  loading: () => <p className="mt-3 text-sm text-muted">预览加载中…</p>
});

type Props = {
  title: string;
  filteredText: string;
  loading?: boolean;
  truncated?: boolean;
  /** 向量索引状态等辅助说明 */
  statusLine?: string;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onClose?: () => void;
};

export default function NoteMarkdownPreview({
  title,
  filteredText,
  loading,
  truncated,
  statusLine,
  keyword,
  onKeywordChange,
  onClose
}: Props) {
  const doc = useMemo(() => <NoteMarkdownDoc filteredText={filteredText} />, [filteredText]);

  return (
    <div className="flex max-h-[min(92vh,800px)] w-full max-w-5xl flex-col rounded-2xl border border-line bg-surface shadow-modal">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 id="note-preview-title" className="text-base font-semibold text-ink">
          {title || "笔记预览"}
        </h3>
        {onClose ? (
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="关键字过滤行"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          aria-label="关键字过滤"
        />
        {truncated ? <p className="mt-2 text-xs text-warning-ink">内容已截断展示</p> : null}
        {statusLine ? <p className="mt-2 text-xs text-muted">{statusLine}</p> : null}
        {loading ? <p className="mt-3 text-sm text-muted">加载中…</p> : null}

        <div className="markdown-body mt-3 max-h-[min(65vh,28rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-3">
          {doc}
        </div>
      </div>
    </div>
  );
}
