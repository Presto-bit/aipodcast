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
  canReindex?: boolean;
  reindexBusy?: boolean;
  onReindex?: () => void;
  structuredBlocks?: Array<{
    id?: string;
    type?: string;
    text?: string;
    level?: number;
  }>;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onToggleSimplified: (enabled: boolean) => void;
  simplified: boolean;
  highlightHint?: string;
  onClose?: () => void;
};

type RenderBlock = {
  id: string;
  markdown: string;
  tocText?: string;
  tocLevel?: number;
  synthetic?: boolean;
};

function statusPillClass(text: string): string {
  const s = String(text || "").toLowerCase();
  const isFail =
    s.includes("failed") ||
    s.includes("error") ||
    s.includes("不可用") ||
    s.includes("失败") ||
    s.includes("未就绪");
  if (isFail) {
    return "border-danger/45 bg-danger-soft text-danger-ink";
  }
  const isProgress =
    s.includes("indexing") ||
    s.includes("处理中") ||
    s.includes("解析中") ||
    s.includes("索引中") ||
    s.includes("摘要中") ||
    s.includes("提取中");
  if (isProgress) {
    return "border-warning/45 bg-warning-soft text-warning-ink";
  }
  const isSuccess =
    s.includes("success") ||
    s.includes("ready") ||
    s.includes("indexed") ||
    s.includes("可问答") ||
    s.includes("可引用") ||
    s.includes("可检索");
  if (isSuccess) {
    return "border-success/45 bg-success-soft text-success-ink";
  }
  return "border-line/70 bg-surface text-ink";
}

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
  canReindex,
  reindexBusy,
  onReindex,
  structuredBlocks,
  keyword,
  onKeywordChange,
  onToggleSimplified,
  simplified,
  highlightHint,
  onClose
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [visibleBlocks, setVisibleBlocks] = useState(20);
  const headingPrefix = useId().replace(/:/g, "");
  const highlightTerm = (keyword || highlightHint || "").trim();
  const blocks = useMemo<RenderBlock[]>(() => {
    const normalizeFromStored = (items: NonNullable<Props["structuredBlocks"]>): RenderBlock[] => {
      const out: RenderBlock[] = [];
      for (const row of items) {
        const text = String(row?.text || "").trim();
        const typ = String(row?.type || "").trim().toLowerCase();
        const level = Number(row?.level || 0);
        if (!text) continue;
        const id = String(row?.id || `sb-${out.length + 1}`);
        if (typ === "heading" || typ === "h1" || typ === "h2" || typ === "h3") {
          const lv = level >= 1 && level <= 3 ? level : 2;
          out.push({ id, markdown: `${"#".repeat(lv)} ${text}`, tocText: text, tocLevel: lv });
        } else if (typ === "table" || typ === "table_row") {
          out.push({ id, markdown: text });
        } else if (typ === "image" || typ === "img") {
          out.push({ id, markdown: text.startsWith("![") ? text : `![image](${text})` });
        } else if (typ === "list_item" || typ === "li") {
          out.push({ id, markdown: text.startsWith("- ") ? text : `- ${text}` });
        } else {
          out.push({ id, markdown: text });
        }
      }
      return out;
    };
    if (Array.isArray(structuredBlocks) && structuredBlocks.length > 0) {
      const stored = normalizeFromStored(structuredBlocks);
      if (stored.length > 0) return stored;
    }
    const normalizeStickyLines = (raw: string): string => {
      const lines = raw.split("\n");
      const out: string[] = [];
      const endPunct = /[。！？.!?;；:：]$/;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          out.push("");
          continue;
        }
        const prev = out.length ? out[out.length - 1] : "";
        const shouldJoin =
          !!prev &&
          prev.trim().length < 90 &&
          line.length < 120 &&
          !endPunct.test(prev.trim()) &&
          !/^([#>\-|*]|\d+\.)/.test(line);
        if (shouldJoin) out[out.length - 1] = `${prev.trim()} ${line}`;
        else out.push(line);
      }
      return out.join("\n");
    };
    const pushParagraph = (target: RenderBlock[], txt: string) => {
      const t = txt.trim();
      if (!t) return;
      target.push({ id: `b-${target.length + 1}`, markdown: t });
    };
    const normalized = normalizeStickyLines(filteredText || "");
    const lines = normalized.split("\n");
    const out: RenderBlock[] = [];
    let i = 0;
    while (i < lines.length) {
      const trimmed = (lines[i] || "").trim();
      if (!trimmed) {
        i += 1;
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      if (heading) {
        out.push({
          id: `b-${out.length + 1}`,
          markdown: trimmed,
          tocText: heading[2].trim(),
          tocLevel: heading[1].length
        });
        i += 1;
        continue;
      }
      if (trimmed.startsWith("|")) {
        const table: string[] = [trimmed];
        i += 1;
        while (i < lines.length && (lines[i] || "").trim().startsWith("|")) {
          table.push((lines[i] || "").trim());
          i += 1;
        }
        out.push({ id: `b-${out.length + 1}`, markdown: table.join("\n") });
        continue;
      }
      if (/^(\- |\* |\d+\.\s+)/.test(trimmed)) {
        const list: string[] = [trimmed];
        i += 1;
        while (i < lines.length && /^(\- |\* |\d+\.\s+)/.test((lines[i] || "").trim())) {
          list.push((lines[i] || "").trim());
          i += 1;
        }
        out.push({ id: `b-${out.length + 1}`, markdown: list.join("\n") });
        continue;
      }
      const paraLines: string[] = [trimmed];
      i += 1;
      while (i < lines.length) {
        const cur = (lines[i] || "").trim();
        if (!cur) break;
        if (/^(#{1,3})\s+/.test(cur) || cur.startsWith("|") || /^(\- |\* |\d+\.\s+)/.test(cur)) break;
        paraLines.push(cur);
        i += 1;
      }
      const paragraph = paraLines.join(" ");
      if (paragraph.length > 260) {
        const chunks = paragraph.split(/(?<=[。！？.!?；;])\s*/).filter(Boolean);
        if (chunks.length > 1) {
          let merged = "";
          for (const c of chunks) {
            const next = `${merged}${merged ? " " : ""}${c}`.trim();
            if (next.length >= 180) {
              pushParagraph(out, next);
              merged = "";
            } else {
              merged = next;
            }
          }
          if (merged) pushParagraph(out, merged);
          continue;
        }
      }
      pushParagraph(out, paragraph);
    }
    if (out.some((b) => b.tocText)) return out;
    const withSynthetic: RenderBlock[] = [];
    let syntheticIndex = 0;
    let charAcc = 0;
    let sectionHint = "";
    for (const b of out) {
      const md = b.markdown.trim();
      if (!md) continue;
      charAcc += md.length;
      sectionHint += `${sectionHint ? " " : ""}${md.slice(0, 40)}`;
      if (charAcc >= 1200) {
        syntheticIndex += 1;
        const title = `章节 ${syntheticIndex} · ${(sectionHint || "内容").slice(0, 18)}`;
        withSynthetic.push({
          id: `s-${syntheticIndex}`,
          markdown: `## ${title}`,
          tocText: title,
          tocLevel: 2,
          synthetic: true
        });
        charAcc = 0;
        sectionHint = "";
      }
      withSynthetic.push(b);
    }
    return withSynthetic;
  }, [filteredText, structuredBlocks]);
  const canLoadMore = blocks.length > visibleBlocks;
  const renderBlocks = useMemo(() => blocks.slice(0, visibleBlocks), [blocks, visibleBlocks]);
  const remainingChars = useMemo(() => {
    const total = blocks.reduce((n, b) => n + (b.markdown || "").length, 0);
    const shown = renderBlocks.reduce((n, b) => n + (b.markdown || "").length, 0);
    return Math.max(0, total - shown);
  }, [blocks, renderBlocks]);
  const statusPills = useMemo(() => {
    const raw = String(statusLine || "").trim();
    if (!raw) return [] as string[];
    return raw
      .split("·")
      .flatMap((chunk) => chunk.split("|"))
      .map((s) => s.trim())
      .filter(Boolean);
  }, [statusLine]);
  const tocItems = useMemo(() => {
    const out: Array<{ id: string; text: string; level: number }> = [];
    for (const b of blocks) {
      if (!b.tocText || !b.tocLevel) continue;
      out.push({ id: `${headingPrefix}-${b.id}`, text: b.tocText, level: b.tocLevel });
      if (out.length >= 36) break;
    }
    return out;
  }, [blocks, headingPrefix]);

  useEffect(() => {
    setVisibleBlocks(20);
  }, [filteredText, simplified]);

  useEffect(() => {
    if (!canLoadMore) return;
    const sentinel = loadMoreRef.current;
    const root = contentRef.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleBlocks((n) => Math.min(n + 12, blocks.length));
        }
      },
      { root, rootMargin: "300px 0px 300px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [blocks.length, canLoadMore, renderBlocks.length]);

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
  }, [renderBlocks, highlightTerm]);

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
          <p className="sm:col-span-2 lg:col-span-3 text-[11px] font-medium text-muted">基本信息</p>
          {statusPills.length > 0 ? (
            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-1.5">
              {statusPills.map((pill, idx) => (
                <span
                  key={`${pill}-${idx}`}
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(pill)}`}
                >
                  {pill}
                </span>
              ))}
            </div>
          ) : null}
          <p>来源标题：<span className="text-ink">{title || "未命名来源"}</span></p>
          <p>类型：<span className="text-ink">{sourceType || "未知"}</span></p>
          <p>上传时间：<span className="text-ink">{createdAt || "-"}</span></p>
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
          {canReindex ? (
            <p className="sm:col-span-2 lg:col-span-3">
              <button
                type="button"
                className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
                disabled={!!reindexBusy}
                onClick={onReindex}
              >
                {reindexBusy ? "重建中…" : "手动重建索引"}
              </button>
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
            <span className="text-[11px] font-medium text-muted">目录（h1~h3/智能章节）</span>
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
        {highlightHint ? (
          <p className="mt-2 rounded border border-brand/30 bg-brand/10 px-2 py-1 text-xs text-brand">
            已定位引用片段：{highlightHint}
          </p>
        ) : null}
        {loading ? <p className="mt-3 text-sm text-muted">加载中…</p> : null}

        <div
          ref={contentRef}
          className="markdown-body mt-3 max-h-[min(72vh,34rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-7 text-ink [word-break:break-word]"
        >
          {renderBlocks.map((b) => (
            <section key={b.id} className={b.synthetic ? "opacity-90" : ""}>
              {b.tocText ? (
                <h4 id={`${headingPrefix}-${b.id}`} className="mb-1 mt-2 text-xs font-semibold text-muted">
                  {b.tocText}
                </h4>
              ) : null}
              <NoteMarkdownDoc filteredText={b.markdown} headingIdPrefix={`${headingPrefix}-${b.id}`} />
            </section>
          ))}
          <div ref={loadMoreRef} className="h-2 w-full" />
        </div>
        {canLoadMore ? (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:bg-fill"
              onClick={() => setVisibleBlocks((n) => Math.min(n + 12, blocks.length))}
            >
              加载更多（剩余约 {remainingChars.toLocaleString()} 字）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
