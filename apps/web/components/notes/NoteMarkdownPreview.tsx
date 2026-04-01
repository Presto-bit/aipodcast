"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";

type Props = {
  title: string;
  filteredText: string;
  loading?: boolean;
  truncated?: boolean;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onClose?: () => void;
};

export default function NoteMarkdownPreview({
  title,
  filteredText,
  loading,
  truncated,
  keyword,
  onKeywordChange,
  onClose
}: Props) {
  const mdBody = useMemo(() => {
    const H = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const className =
        Tag === "h1"
          ? "mt-4 text-lg font-bold text-ink"
          : Tag === "h2"
            ? "mt-3 text-base font-semibold text-ink"
            : "mt-2 text-sm font-medium text-ink";
      const Comp = (props: { children?: React.ReactNode }) =>
        React.createElement(Tag, { className }, props.children);
      return Comp;
    };
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: H("h1"),
          h2: H("h2"),
          h3: H("h3"),
          h4: H("h4"),
          h5: H("h5"),
          h6: H("h6"),
          p: ({ children }) => <p className="mb-2 text-sm leading-relaxed text-ink">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-inside list-disc text-sm text-ink">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-inside list-decimal text-sm text-ink">{children}</ol>,
          code: ({ className, children }) =>
            className ? (
              <pre className="mb-2 overflow-x-auto rounded bg-fill p-2 text-xs">
                <code>{children}</code>
              </pre>
            ) : (
              <code className="rounded bg-track px-1 text-xs">{children}</code>
            ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-4 border-line pl-3 text-sm text-ink">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-brand underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {filteredText}
      </ReactMarkdown>
    );
  }, [filteredText]);

  return (
    <div className="flex max-h-[min(92vh,800px)] w-full max-w-5xl flex-col rounded-2xl border border-line bg-white shadow-2xl">
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
        {truncated ? <p className="mt-2 text-xs text-amber-700">内容已截断展示</p> : null}
        {loading ? <p className="mt-3 text-sm text-muted">加载中…</p> : null}

        <div className="markdown-body mt-3 max-h-[min(65vh,28rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-white p-3">
          {mdBody}
        </div>
      </div>
    </div>
  );
}
