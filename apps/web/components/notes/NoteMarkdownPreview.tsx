"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { estimateWordCount } from "../../lib/noteWordCount";
import { shouldShowVectorTruncationWarning } from "../../lib/noteCoverageCopy";

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
  wordCount?: number;
  ragIndexTruncated?: boolean;
  ragIndexCoveragePct?: number;
  ragIndexStrategy?: string;
  shardsTotal?: number;
  shardsWithSummary?: number;
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
  /** 全文 UTF-16 字符区间高亮（与 preview_text 正文一致） */
  charHighlightRange?: { start: number; end: number } | null;
  /** 问答角标引用视图：隐藏全书元数据，仅展示摘录/上下文 */
  citationView?: boolean;
  onClose?: () => void;
};

type RenderBlock = {
  id: string;
  markdown: string;
  tocText?: string;
  tocLevel?: number;
  synthetic?: boolean;
};

function normalizeSearchAnchor(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从全文 UTF-16 区间取可在预览 DOM 中搜索的定位锚文本 */
function pickRangeAnchor(fullText: string, start: number, end: number): string {
  const len = fullText.length;
  if (len <= 0 || end <= start) return "";
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s + 1, Math.min(end, len));
  let anchor = normalizeSearchAnchor(fullText.slice(s, e));
  if (anchor.length >= 16) return anchor.slice(0, 160);
  const pad = normalizeSearchAnchor(fullText.slice(Math.max(0, s - 24), Math.min(len, e + 120)));
  return pad.slice(0, 160);
}

function findBlockIndexForAnchor(blocks: RenderBlock[], anchor: string): number {
  const a = normalizeSearchAnchor(anchor);
  if (a.length < 8) return -1;
  for (let len = Math.min(100, a.length); len >= 12; len -= 4) {
    const probe = a.slice(0, len);
    for (let i = 0; i < blocks.length; i++) {
      if (normalizeSearchAnchor(blocks[i].markdown).includes(probe)) return i;
    }
  }
  return -1;
}

function anchorToFlexiblePattern(anchor: string): string {
  const compact = normalizeSearchAnchor(anchor).slice(0, 120);
  if (!compact) return "";
  return compact
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

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
    s.includes("成功") ||
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
  wordCount,
  ragIndexTruncated,
  ragIndexCoveragePct,
  ragIndexStrategy,
  shardsTotal,
  shardsWithSummary,
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
  charHighlightRange,
  citationView = false,
  onClose
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const citationExpandAllRef = useRef(false);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [visibleBlocks, setVisibleBlocks] = useState(20);
  const headingPrefix = useId().replace(/:/g, "");
  const rangeAnchor = useMemo(() => {
    if (!charHighlightRange || charHighlightRange.end <= charHighlightRange.start) return "";
    return pickRangeAnchor(filteredText, charHighlightRange.start, charHighlightRange.end);
  }, [filteredText, charHighlightRange?.start, charHighlightRange?.end]);
  /** 引用跳转优先用全文区间锚文本，其次关键字 */
  const highlightTerm = (rangeAnchor || keyword || "").trim();
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
  const previewWordCount = useMemo(() => estimateWordCount(filteredText), [filteredText]);
  const displayWordCount =
    typeof wordCount === "number" && wordCount > 0 ? wordCount : previewWordCount;
  const remainingWords = useMemo(() => {
    const hidden = blocks.slice(visibleBlocks);
    return estimateWordCount(hidden.map((b) => b.markdown || "").join("\n\n"));
  }, [blocks, visibleBlocks]);
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
    citationExpandAllRef.current = false;
  }, [charHighlightRange?.start, charHighlightRange?.end, filteredText]);

  useEffect(() => {
    const anchor = rangeAnchor || normalizeSearchAnchor(keyword);
    if (anchor.length < 8) return;
    const idx = findBlockIndexForAnchor(blocks, anchor);
    if (idx < 0) return;
    setVisibleBlocks((n) => Math.max(n, Math.min(blocks.length, idx + 3)));
  }, [blocks, rangeAnchor, keyword]);

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

    const pattern = rangeAnchor ? anchorToFlexiblePattern(rangeAnchor) : highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!pattern) return;
    const re = new RegExp(pattern, rangeAnchor ? "i" : "gi");
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
        mark.className = rangeAnchor
          ? "rounded bg-brand/25 px-[1px] text-ink ring-1 ring-brand/40"
          : "rounded bg-warning/35 px-[1px] text-ink";
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
    } else if (
      rangeAnchor &&
      renderBlocks.length < blocks.length &&
      !citationExpandAllRef.current
    ) {
      citationExpandAllRef.current = true;
      setVisibleBlocks(blocks.length);
      setActiveMatchIndex(0);
    } else {
      setActiveMatchIndex(0);
    }

    return () => {
      unwrap();
    };
  }, [renderBlocks, highlightTerm, rangeAnchor, blocks.length]);

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
        {citationView ? (
          <p className="mb-3 rounded-lg border border-line/70 bg-fill/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
            以下为问答引用内容（摘录或附近上下文），不是整本资料预览。需要全书请从资料列表打开。
          </p>
        ) : (
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
          <p>参考资料标题：<span className="text-ink">{title || "未命名参考资料"}</span></p>
          <p>类型：<span className="text-ink">{sourceType || "未知"}</span></p>
          <p>上传时间：<span className="text-ink">{createdAt || "-"}</span></p>
          <p>字数：<span className="text-ink tabular-nums">{displayWordCount > 0 ? displayWordCount.toLocaleString() : "-"}</span></p>
          {shouldShowVectorTruncationWarning({
            ragIndexTruncated,
            ragIndexCoveragePct,
            shardsTotal,
            shardsWithSummary
          }) ? (
            <p className="sm:col-span-2 lg:col-span-3 text-[11px] leading-relaxed text-warning-ink">
              全文已保存。向量检索块约覆盖全文的 {ragIndexCoveragePct}%
              {ragIndexStrategy === "head_tail" ? "（前段与尾段抽样）" : "（前段抽样）"}
              ，用于相似度召回；若片摘要尚未齐，中间段落可能难引用。片摘要完成后问答主要走片路由，不限于该比例。
            </p>
          ) : shardsTotal && shardsTotal > 1 && (shardsWithSummary ?? 0) >= shardsTotal ? (
            <p className="sm:col-span-2 lg:col-span-3 text-[11px] leading-relaxed text-muted">
              全文已保存。片摘要 {shardsWithSummary}/{shardsTotal} 已完成，问答可走片路由与精读；向量块约 {ragIndexCoveragePct}%
              为检索抽样，不代表资料未处理完。
            </p>
          ) : null}
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
              参考资料链接：<a href={sourceUrl} target="_blank" rel="noreferrer" className="text-brand underline">{sourceUrl}</a>
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
        )}
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder={citationView ? "在引用内容中搜索" : "关键字过滤行"}
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
              加载更多（剩余约 {remainingWords.toLocaleString()} 字）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
