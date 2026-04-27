"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";

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
  sourceType?: string;
  createdAt?: string;
  preprocessStage?: string;
  nextAction?: string;
  wordCount?: number;
  sourceUrl?: string;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onToggleSimplified: (enabled: boolean) => void;
  simplified: boolean;
  highlightHint?: string;
  onClose?: () => void;
};

export default function NoteMarkdownPreview({
  title,
  filteredText,
  loading,
  truncated,
  statusLine,
  sourceType,
  createdAt,
  preprocessStage,
  nextAction,
  wordCount,
  sourceUrl,
  keyword,
  onKeywordChange,
  onToggleSimplified,
  simplified,
  highlightHint,
  onClose
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [renderChars, setRenderChars] = useState(16000);
  const headingPrefix = useId().replace(/:/g, "");
  const highlightTerm = (keyword || highlightHint || "").trim();
  const canLoadMore = filteredText.length > renderChars;
  const renderText = useMemo(() => filteredText.slice(0, renderChars), [filteredText, renderChars]);
  const doc = useMemo(
    () => <NoteMarkdownDoc filteredText={renderText} headingIdPrefix={headingPrefix} />,
    [headingPrefix, renderText]
  );
  const tocItems = useMemo(() => {
    const lines = renderText.split("\n");
    const slugs: Record<string, number> = {};
    const out: Array<{ id: string; text: string; level: number }> = [];
    for (const line of lines) {
      const m = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      const level = m[1].length;
      const text = m[2].trim();
      const slugBase = text
        .toLowerCase()
        .replace(/[^\u4e00-\u9fffa-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-") || "section";
      const n = (slugs[slugBase] || 0) + 1;
      slugs[slugBase] = n;
      const id = `${headingPrefix}-${slugBase}${n > 1 ? `-${n}` : ""}`;
      out.push({ id, text, level });
      if (out.length >= 20) break;
    }
    return out;
  }, [headingPrefix, renderText]);

  useEffect(() => {
    setRenderChars(16000);
  }, [filteredText]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const unwrap = () => {
      const marks = root.querySelectorAll("mark[data-note-highlight='1']");
      marks.forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      });
    };

    unwrap();
    if (!highlightTerm) {
      setMatchCount(0);
      setActiveMatchIndex(0);
      return;
    }

    const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escaped) return;
    const re = new RegExp(escaped, "gi");
    let firstMark: HTMLElement | undefined;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parentEl = node.parentElement;
      if (!parentEl) continue;
      const tag = parentEl.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") continue;
      if ((node.nodeValue || "").trim()) textNodes.push(node);
    }

    textNodes.forEach((node) => {
      const txt = node.nodeValue || "";
      if (!re.test(txt)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(txt)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (start > last) frag.appendChild(document.createTextNode(txt.slice(last, start)));
        const mark = document.createElement("mark");
        mark.setAttribute("data-note-highlight", "1");
        mark.className = "rounded bg-warning/35 px-[1px] text-ink";
        mark.textContent = txt.slice(start, end);
        if (!firstMark) firstMark = mark;
        frag.appendChild(mark);
        last = end;
      }
      if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    });

    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark[data-note-highlight='1']"));
    setMatchCount(marks.length);
    if (marks.length > 0) {
      setActiveMatchIndex(0);
      marks[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setActiveMatchIndex(0);
    }

    return () => {
      unwrap();
    };
  }, [renderText, highlightTerm]);

  function jumpToMatch(offset: number) {
    const root = contentRef.current;
    if (!root || matchCount <= 0) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark[data-note-highlight='1']"));
    if (!marks.length) return;
    const next = (activeMatchIndex + offset + marks.length) % marks.length;
    setActiveMatchIndex(next);
    marks[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

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
        <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-line/70 bg-fill/30 p-3 text-xs text-muted sm:grid-cols-2 lg:grid-cols-3">
          <p>来源标题：<span className="text-ink">{title || "未命名来源"}</span></p>
          <p>类型：<span className="text-ink">{sourceType || "未知"}</span></p>
          <p>上传时间：<span className="text-ink">{createdAt || "-"}</span></p>
          <p>预处理状态：<span className="text-ink">{preprocessStage || "-"}</span></p>
          <p>字数：<span className="text-ink tabular-nums">{typeof wordCount === "number" ? wordCount.toLocaleString() : "-"}</span></p>
          <p>
            视图：
            <button
              type="button"
              className="ml-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink hover:bg-fill"
              onClick={() => onToggleSimplified(!simplified)}
            >
              {simplified ? "精简视图" : "原文视图"}
            </button>
          </p>
          {sourceUrl ? (
            <p className="sm:col-span-2 lg:col-span-3 break-all">
              来源链接：<a href={sourceUrl} target="_blank" rel="noreferrer" className="text-brand underline">{sourceUrl}</a>
            </p>
          ) : null}
          {nextAction ? (
            <p className="sm:col-span-2 lg:col-span-3">
              下一步：<span className="text-ink">{nextAction}</span>
            </p>
          ) : null}
        </div>
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="关键字过滤行"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          aria-label="关键字过滤"
        />
        {tocItems.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded border border-line/70 bg-fill/20 p-2">
            <span className="text-[11px] font-medium text-muted">目录</span>
            {tocItems.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`rounded border border-line/60 bg-surface px-1.5 py-0.5 text-[11px] text-ink hover:bg-fill ${
                  t.level >= 3 ? "ml-1" : ""
                }`}
                onClick={() => {
                  const root = contentRef.current;
                  if (!root) return;
                  const el = root.querySelector<HTMLElement>(`#${CSS.escape(t.id)}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                title={t.text}
              >
                {t.text}
              </button>
            ))}
          </div>
        ) : null}
        {matchCount > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <span>
              命中 {activeMatchIndex + 1}/{matchCount}
            </span>
            <button
              type="button"
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink hover:bg-fill"
              onClick={() => jumpToMatch(-1)}
            >
              上一个
            </button>
            <button
              type="button"
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink hover:bg-fill"
              onClick={() => jumpToMatch(1)}
            >
              下一个
            </button>
          </div>
        ) : null}
        {truncated ? <p className="mt-2 text-xs text-warning-ink">内容已截断展示</p> : null}
        {statusLine ? <p className="mt-2 text-xs text-muted">{statusLine}</p> : null}
        {highlightHint ? (
          <p className="mt-2 rounded border border-brand/30 bg-brand/10 px-2 py-1 text-xs text-brand">
            已定位引用片段：{highlightHint}
          </p>
        ) : null}
        {loading ? <p className="mt-3 text-sm text-muted">加载中…</p> : null}

        <div
          ref={contentRef}
          className="markdown-body mt-3 max-h-[min(65vh,28rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-3"
        >
          {doc}
        </div>
        {canLoadMore ? (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:bg-fill"
              onClick={() => setRenderChars((n) => n + 16000)}
            >
              加载更多（剩余约 {(filteredText.length - renderChars).toLocaleString()} 字符）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
