"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { estimateWordCount } from "../../lib/noteWordCount";
import { shouldShowVectorTruncationWarning } from "../../lib/noteCoverageCopy";
import {
  type NoteDisplayProfile,
  type NotePageBreak,
  profileShowOpenSource,
  profileShowSimplifiedToggle,
  profileShowToc,
  profileTypeLabel,
  sourceUrlHostname
} from "../../lib/noteReaderDisplayProfile";
import {
  blockHasInlineHeading,
  buildRenderBlocksFromText,
  extractSheetTabs,
  injectPageBreakBlocks,
  type NoteRenderBlock
} from "../../lib/noteReaderBlocks";

const NoteMarkdownDoc = dynamic(() => import("./NoteMarkdownDoc"), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-muted">正文加载中…</p>
});

type Props = {
  title: string;
  filteredText: string;
  displayProfile: NoteDisplayProfile;
  ext?: string;
  pageBreaks?: NotePageBreak[];
  inputType?: string;
  loading?: boolean;
  truncated?: boolean;
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
  parseDetail?: string;
  parseState?: string;
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
  charHighlightRange?: { start: number; end: number } | null;
  citationView?: boolean;
  onClose?: () => void;
  onDownloadFile?: () => void;
  onViewFullDocument?: () => void;
};

function normalizeSearchAnchor(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

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

function findBlockIndexForAnchor(blocks: NoteRenderBlock[], anchor: string): number {
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
  if (isFail) return "border-danger/45 bg-danger-soft text-danger-ink";
  const isProgress =
    s.includes("indexing") ||
    s.includes("处理中") ||
    s.includes("解析中") ||
    s.includes("索引中") ||
    s.includes("摘要中") ||
    s.includes("提取中");
  if (isProgress) return "border-warning/45 bg-warning-soft text-warning-ink";
  const isSuccess =
    s.includes("成功") ||
    s.includes("success") ||
    s.includes("ready") ||
    s.includes("indexed") ||
    s.includes("可问答") ||
    s.includes("可引用") ||
    s.includes("可检索");
  if (isSuccess) return "border-success/45 bg-success-soft text-success-ink";
  return "border-line/70 bg-surface text-ink";
}

function statusNeedsAttention(statusLine?: string): boolean {
  const s = String(statusLine || "").toLowerCase();
  return (
    s.includes("failed") ||
    s.includes("失败") ||
    s.includes("解析") ||
    s.includes("索引") ||
    s.includes("处理中")
  );
}

const iconBtn =
  "rounded-lg border border-line/70 bg-surface px-2 py-1 text-xs text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40";

export default function NoteMarkdownPreview({
  title,
  filteredText,
  displayProfile,
  ext,
  pageBreaks = [],
  inputType,
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
  parseDetail,
  parseState,
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
  onClose,
  onDownloadFile,
  onViewFullDocument
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const citationExpandAllRef = useRef(false);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [visibleBlocks, setVisibleBlocks] = useState(20);
  const [searchOpen, setSearchOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const headingPrefix = useId().replace(/:/g, "");

  const isTable = displayProfile === "table";
  const isUnavailable = displayProfile === "unavailable";
  const isCitation = displayProfile === "citation";
  const showToc = profileShowToc(displayProfile);
  const typeLabel = profileTypeLabel(ext, displayProfile);
  const host = sourceUrlHostname(sourceUrl);

  const rangeAnchor = useMemo(() => {
    if (!charHighlightRange || charHighlightRange.end <= charHighlightRange.start) return "";
    return pickRangeAnchor(filteredText, charHighlightRange.start, charHighlightRange.end);
  }, [filteredText, charHighlightRange?.start, charHighlightRange?.end]);

  const highlightTerm = (rangeAnchor || keyword || "").trim();

  const blocks = useMemo(() => {
    const base = buildRenderBlocksFromText(filteredText, structuredBlocks);
    if (displayProfile === "prose" && pageBreaks.length > 0 && !citationView) {
      return injectPageBreakBlocks(base, filteredText, pageBreaks);
    }
    return base;
  }, [filteredText, structuredBlocks, displayProfile, pageBreaks, citationView]);

  const sheetTabs = useMemo(() => (isTable ? extractSheetTabs(blocks) : []), [blocks, isTable]);

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
    if (!showToc || isTable) return [];
    const out: Array<{ id: string; text: string; level: number }> = [];
    for (const b of blocks) {
      if (!b.tocText || !b.tocLevel || b.pageLabel) continue;
      out.push({ id: `${headingPrefix}-${b.id}`, text: b.tocText, level: b.tocLevel });
      if (out.length >= 36) break;
    }
    return out;
  }, [blocks, headingPrefix, showToc, isTable]);

  const pageCount = pageBreaks.length > 0 ? pageBreaks[pageBreaks.length - 1]?.page : 0;
  const docVariant = isTable ? "table" : "prose";

  const scrollToBlockId = useCallback((blockId: string) => {
    const root = contentRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToHeading = useCallback(
    (headingDomId: string) => {
      const root = contentRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(headingDomId)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    []
  );

  useEffect(() => {
    setVisibleBlocks(20);
    setSearchOpen(false);
    setMetaOpen(false);
    setTocOpen(false);
  }, [filteredText, simplified, displayProfile]);

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
    if (!canLoadMore || isUnavailable) return;
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
  }, [blocks.length, canLoadMore, renderBlocks.length, isUnavailable]);

  useEffect(() => {
    if (isUnavailable) return;
    const root = contentRef.current;
    if (!root) return;

    const unwrap = () => {
      root.querySelectorAll("mark[data-note-highlight='1']").forEach((m) => {
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

    const pattern = rangeAnchor
      ? anchorToFlexiblePattern(rangeAnchor)
      : highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!pattern) return;
    const re = new RegExp(pattern, rangeAnchor ? "i" : "gi");
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
  }, [renderBlocks, highlightTerm, rangeAnchor, blocks.length, isUnavailable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tocOpen) {
          setTocOpen(false);
          e.preventDefault();
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          e.preventDefault();
          return;
        }
        if (metaOpen) {
          setMetaOpen(false);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tocOpen, searchOpen, metaOpen]);

  function jumpToMatch(offset: number) {
    const root = contentRef.current;
    if (!root || matchCount <= 0) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark[data-note-highlight='1']"));
    if (!marks.length) return;
    const next = (activeMatchIndex + offset + marks.length) % marks.length;
    setActiveMatchIndex(next);
    marks[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const metaPanel = !isCitation && metaOpen ? (
    <div className="shrink-0 border-b border-line/60 bg-fill/20 px-4 py-3 text-xs text-muted max-h-[40vh] overflow-y-auto">
      <p className="mb-2 text-[11px] font-medium text-muted">资料信息</p>
      {statusPills.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {statusPills.map((pill, idx) => (
            <span
              key={`${pill}-${idx}`}
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(pill)}`}
            >
              {pill}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mb-1">
        类型 <span className="text-ink">{sourceType || typeLabel}</span>
        {createdAt ? (
          <>
            {" "}
            · 上传 <span className="text-ink">{createdAt}</span>
          </>
        ) : null}
        {displayWordCount > 0 ? (
          <>
            {" "}
            · <span className="tabular-nums text-ink">{displayWordCount.toLocaleString()}</span> 字
          </>
        ) : null}
      </p>
      {profileShowSimplifiedToggle(displayProfile) ? (
        <p className="mb-2">
          视图{" "}
          <button
            type="button"
            className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink hover:bg-fill"
            onClick={() => onToggleSimplified(!simplified)}
          >
            {simplified ? "精简（去网页噪声）" : "原文"}
          </button>
        </p>
      ) : null}
      {shouldShowVectorTruncationWarning({
        ragIndexTruncated,
        ragIndexCoveragePct,
        shardsTotal,
        shardsWithSummary
      }) ? (
        <p className="mb-2 text-[11px] leading-relaxed text-warning-ink">
          全文已保存。向量检索块约覆盖全文的 {ragIndexCoveragePct}%
          {ragIndexStrategy === "head_tail" ? "（前段与尾段抽样）" : "（前段抽样）"}
          ，用于相似度召回。
        </p>
      ) : shardsTotal && shardsTotal > 1 && (shardsWithSummary ?? 0) >= shardsTotal ? (
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          片摘要 {shardsWithSummary}/{shardsTotal} 已完成；向量块约 {ragIndexCoveragePct}% 为检索抽样。
        </p>
      ) : null}
      {sourceUrl ? (
        <p className="mb-2 break-all">
          来源{" "}
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-brand underline">
            {sourceUrl}
          </a>
        </p>
      ) : null}
      {parseState === "partial" ? (
        <p className="mb-2 text-[11px] text-warning-ink">正文解析不完整，以下内容为已提取部分。</p>
      ) : null}
      {canReindex ? (
        <button
          type="button"
          className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
          disabled={!!reindexBusy}
          onClick={onReindex}
        >
          {reindexBusy ? "重建中…" : "手动重建索引"}
        </button>
      ) : null}
    </div>
  ) : null;

  const searchBar = searchOpen ? (
    <div className="shrink-0 border-b border-line/60 bg-surface px-4 py-2">
      <input
        className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
        placeholder={isCitation ? "在引用内容中搜索" : isTable ? "在表格中搜索" : "在本文中搜索"}
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        aria-label="搜索正文"
        autoFocus
      />
      {matchCount > 0 ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span>
            命中 {activeMatchIndex + 1}/{matchCount}
          </span>
          <button type="button" className={iconBtn} onClick={() => jumpToMatch(-1)}>
            上一个
          </button>
          <button type="button" className={iconBtn} onClick={() => jumpToMatch(1)}>
            下一个
          </button>
        </div>
      ) : null}
      {highlightHint ? <p className="mt-1 text-xs text-brand">已定位：{highlightHint}</p> : null}
    </div>
  ) : null;

  const tocSidebar =
    tocOpen && showToc && tocItems.length > 0 ? (
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line/60 bg-fill/10 p-3 lg:block">
        <p className="mb-2 text-[11px] font-medium text-muted">目录</p>
        <nav className="flex flex-col gap-0.5">
          {tocItems.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`truncate rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-fill/60 ${
                t.level >= 3 ? "pl-6" : t.level >= 2 ? "pl-3" : ""
              }`}
              title={t.text}
              onClick={() => scrollToHeading(t.id)}
            >
              {t.text}
            </button>
          ))}
        </nav>
      </aside>
    ) : null;

  const tocSheet =
    tocOpen && showToc && tocItems.length > 0 ? (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[530] bg-black/30 lg:hidden"
          aria-label="关闭目录"
          onClick={() => setTocOpen(false)}
        />
        <div
          className="fixed inset-x-0 bottom-0 z-[531] max-h-[50vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 lg:hidden"
          role="dialog"
          aria-label="目录"
        >
          <p className="mb-2 text-sm font-medium text-ink">目录</p>
          <nav className="flex flex-col gap-1">
            {tocItems.map((t) => (
              <button
                key={t.id}
                type="button"
                className="rounded px-2 py-2 text-left text-sm text-ink hover:bg-fill"
                onClick={() => {
                  scrollToHeading(t.id);
                  setTocOpen(false);
                }}
              >
                {t.text}
              </button>
            ))}
          </nav>
        </div>
      </>
    ) : null;

  const sheetBar =
    isTable && sheetTabs.length > 1 ? (
      <div className="shrink-0 flex flex-wrap gap-1 border-b border-line/60 px-4 py-2">
        {sheetTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="rounded-full border border-line/70 bg-surface px-2.5 py-1 text-xs text-ink hover:bg-fill"
            onClick={() => scrollToBlockId(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>
    ) : null;

  const bodyInner = isUnavailable ? (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-base font-medium text-ink">暂无法阅读正文</p>
      <p className="mt-2 max-w-md text-sm text-muted">
        {parseDetail?.trim().slice(0, 200) ||
          (loading
            ? "正在提取正文，请稍候…"
            : "可能尚未解析完成，或文件为扫描件/图片版。可下载原文件查看。")}
      </p>
      {onDownloadFile ? (
        <button type="button" className={`${iconBtn} mt-4 px-4 py-2`} onClick={onDownloadFile}>
          下载原文件
        </button>
      ) : null}
    </div>
  ) : (
    <>
      {isCitation ? (
        <p className="shrink-0 px-6 pt-4 text-xs text-muted">
          以下为问答引用内容（摘录或附近上下文）。需要全书请从资料列表或下方按钮打开。
        </p>
      ) : null}
      {truncated ? (
        <p className="shrink-0 px-6 pt-3 text-xs text-warning-ink">
          预览仅展示前 40 万字，全文已保存，问答仍可使用完整内容。
        </p>
      ) : null}
      {loading ? <p className="shrink-0 px-6 py-3 text-sm text-muted">加载中…</p> : null}
      <div
        ref={contentRef}
        className={`min-h-0 flex-1 overflow-y-auto ${
          isTable ? "bg-surface px-4 py-4" : "bg-fill/15 px-4 py-6 sm:px-6"
        }`}
      >
        <div className={isTable ? "w-full" : "mx-auto w-full max-w-[42rem]"}>
          {renderBlocks.map((b) => (
            <section key={b.id} data-block-id={b.id} className={b.synthetic && !b.pageLabel ? "opacity-90" : ""}>
              {b.pageLabel ? (
                <div
                  className="my-6 flex items-center gap-3 text-xs font-medium text-muted"
                  aria-label={b.pageLabel}
                >
                  <span className="h-px flex-1 bg-line/70" />
                  <span>{b.pageLabel}</span>
                  <span className="h-px flex-1 bg-line/70" />
                </div>
              ) : null}
              {b.tocText && !blockHasInlineHeading(b) && !b.pageLabel ? (
                <h4
                  id={`${headingPrefix}-${b.id}`}
                  className="mb-2 mt-4 scroll-mt-4 text-sm font-semibold text-muted"
                >
                  {b.tocText}
                </h4>
              ) : null}
              {b.markdown ? (
                <NoteMarkdownDoc
                  filteredText={b.markdown}
                  headingIdPrefix={`${headingPrefix}-${b.id}`}
                  variant={docVariant}
                />
              ) : null}
            </section>
          ))}
          <div ref={loadMoreRef} className="h-2 w-full" />
        </div>
      </div>
      {canLoadMore ? (
        <div className="shrink-0 flex justify-center border-t border-line/40 py-2">
          <button type="button" className={iconBtn} onClick={() => setVisibleBlocks((n) => Math.min(n + 12, blocks.length))}>
            继续阅读（约剩 {remainingWords.toLocaleString()} 字）
          </button>
        </div>
      ) : null}
      {isCitation && onViewFullDocument ? (
        <div className="shrink-0 border-t border-line/60 px-4 py-3">
          <button type="button" className={`${iconBtn} w-full py-2`} onClick={onViewFullDocument}>
            查看全书资料
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line/60 px-3 py-2.5 sm:px-4">
        {onClose ? (
          <button type="button" className="shrink-0 text-sm text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-fill px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {typeLabel}
            </span>
            <h3 id="note-preview-title" className="truncate text-base font-semibold text-ink">
              {title || "参考资料"}
            </h3>
          </div>
          {displayProfile === "web" && host ? (
            <p className="truncate text-xs text-muted">来源 {host}</p>
          ) : null}
          {displayProfile === "prose" && ext === "pdf" && pageCount > 0 ? (
            <p className="text-xs text-muted">提取正文 · 共 {pageCount} 页</p>
          ) : null}
          {displayProfile === "table" ? <p className="text-xs text-muted">表格预览（提取为 Markdown）</p> : null}
          {isCitation ? <p className="text-xs text-muted">引用摘录 · 非全书</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {profileShowOpenSource(displayProfile, sourceUrl) && sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className={iconBtn}
            >
              原文
            </a>
          ) : null}
          {onDownloadFile && inputType === "note_file" && !isCitation ? (
            <button type="button" className={iconBtn} onClick={onDownloadFile}>
              下载
            </button>
          ) : null}
          {!isUnavailable ? (
            <button
              type="button"
              className={iconBtn}
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((v) => !v);
                if (!searchOpen) setTocOpen(false);
              }}
            >
              搜索
            </button>
          ) : null}
          {showToc && tocItems.length > 0 ? (
            <button
              type="button"
              className={iconBtn}
              aria-expanded={tocOpen}
              onClick={() => {
                setTocOpen((v) => !v);
                if (!tocOpen) setSearchOpen(false);
              }}
            >
              目录
            </button>
          ) : null}
          {!isCitation ? (
            <button
              type="button"
              className={`${iconBtn} relative`}
              aria-expanded={metaOpen}
              onClick={() => setMetaOpen((v) => !v)}
            >
              信息
              {statusNeedsAttention(statusLine) ? (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning" aria-hidden />
              ) : null}
            </button>
          ) : null}
        </div>
      </header>

      {metaPanel}
      {searchBar}
      {sheetBar}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tocSidebar}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{bodyInner}</div>
      </div>

      {tocSheet}
    </div>
  );
}
