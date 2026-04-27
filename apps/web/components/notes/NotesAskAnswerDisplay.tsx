"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { NotesAskSource, NotesAskWebSource } from "../../lib/notesAskCitation";
import { extractCitedSourceIndexes } from "../../lib/notesAskCitation";
import NotesAskAnswerMarkdownBody from "./NotesAskAnswerMarkdownBody";

type Props = {
  text: string;
  /** 与编排器 done.sources 一致；有则 [n] 可点击并展示脚注。 */
  sources?: NotesAskSource[];
  /** 联网检索来源，[w1] 外链与脚注 */
  webSources?: NotesAskWebSource[];
  className?: string;
  onOpenSourceFromCitation?: (payload: { noteId: string; index: string; excerpt?: string }) => void;
};

export { normalizeNotesAskAnswerForDisplay } from "../../lib/notesAskAnswerNormalize";

function SourceExcerptModal({
  source,
  open,
  onClose
}: {
  source: NotesAskSource | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !source) return null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fym-workspace-scrim z-[1200] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-ask-source-modal-title"
      onClick={onClose}
    >
      <div
        className="max-h-[min(80vh,560px)] w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line/80 px-4 py-3">
          <h2 id="notes-ask-source-modal-title" className="text-sm font-semibold text-ink">
            来源 [{source.index}] {source.title}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-muted">{source.noteId}</p>
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-ink">
          {source.chunks && source.chunks.length > 0 ? (
            <ul className="space-y-3">
              {source.chunks.map((c, i) => (
                <li key={`${c.chunkIndex}-${i}`} className="rounded-lg border border-line/70 bg-fill/40 p-2.5">
                  <p className="text-[11px] font-medium text-muted">
                    块 {c.chunkIndex}
                    {c.score ? <span className="ml-2">score {c.score}</span> : null}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-ink">{c.excerpt || "（无摘录）"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">本条暂无向量检索摘录，请以正文角标对应资料中的来源全文为准。</p>
          )}
        </div>
        <div className="border-t border-line/80 px-4 py-2.5 text-right">
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 对话回答区：GFM Markdown + 段落/列表/代码块等排版；可选将 [n] 等标为指向脚注的内链。
 */
export function NotesAskAnswerDisplay({ text, sources, webSources, className, onOpenSourceFromCitation }: Props) {
  const [modalSource, setModalSource] = useState<NotesAskSource | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [webSourcesOpen, setWebSourcesOpen] = useState(false);
  const [onlyCitedSources, setOnlyCitedSources] = useState(false);

  const sortedSources = useMemo(() => {
    if (!sources?.length) return [];
    return [...sources].sort((a, b) => Number(a.index) - Number(b.index));
  }, [sources]);
  const citedSourceIndexes = useMemo(() => extractCitedSourceIndexes(text), [text]);
  const visibleSources = useMemo(() => {
    if (!onlyCitedSources) return sortedSources;
    return sortedSources.filter((s) => citedSourceIndexes.has(s.index));
  }, [sortedSources, citedSourceIndexes, onlyCitedSources]);

  const sortedWebSources = useMemo(() => {
    if (!webSources?.length) return [];
    return [...webSources].sort((a, b) => {
      const na = Number(String(a.index).replace(/^w/i, "")) || 0;
      const nb = Number(String(b.index).replace(/^w/i, "")) || 0;
      return na - nb;
    });
  }, [webSources]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const expandIfCitationHash = () => {
      const h = window.location.hash || "";
      if (/^#cite-w\d/i.test(h)) setWebSourcesOpen(true);
      else if (/^#cite-/.test(h)) setSourcesOpen(true);
    };
    expandIfCitationHash();
    window.addEventListener("hashchange", expandIfCitationHash);
    return () => window.removeEventListener("hashchange", expandIfCitationHash);
  }, []);

  const wrap = className?.trim() ? className : "";

  return (
    <div className={`notes-ask-answer flex min-w-0 flex-col gap-3 text-ink ${wrap}`}>
      <NotesAskAnswerMarkdownBody
        text={text}
        sources={sources}
        webSources={webSources}
        onCitationClick={(index) => {
          setSourcesOpen(true);
          const src = sortedSources.find((s) => s.index === index);
          if (src?.noteId) {
            onOpenSourceFromCitation?.({
              noteId: src.noteId,
              index,
              excerpt: src.chunks?.[0]?.excerpt
            });
          }
        }}
        onWebCitationClick={() => setWebSourcesOpen(true)}
      />

      {sortedSources.length > 0 ? (
        <aside
          className="mt-1 border-t border-line/70 pt-3 text-xs text-ink"
          aria-label="引用来源"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg py-0.5 text-left text-ink hover:bg-fill/50"
            onClick={() => setSourcesOpen((o) => !o)}
            aria-expanded={sourcesOpen}
            aria-controls="notes-ask-citation-footnotes"
          >
            <span className="font-semibold">引用来源（资料库）</span>
            <span className="shrink-0 text-[11px] font-medium text-muted">{sourcesOpen ? "收起" : "展开"}</span>
          </button>
          <div id="notes-ask-citation-footnotes" className="mt-2" hidden={!sourcesOpen}>
            <p className="text-[11px] text-muted">
              点击正文中的 [n] 可跳转到下方对应脚注；关键处若出现「」短引文，可与下方摘录对照。有检索摘录时点击「查看摘录」可在弹窗中阅读块原文。与网页摘要冲突时以资料库为准。
            </p>
            {citedSourceIndexes.size > 0 ? (
              <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-line"
                  checked={onlyCitedSources}
                  onChange={(e) => setOnlyCitedSources(e.target.checked)}
                />
                仅显示正文已引用来源
              </label>
            ) : null}
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] leading-snug">
              {visibleSources.map((s) => (
                <li key={`${s.noteId}-${s.index}`} id={`cite-${s.index}`} className="scroll-mt-20">
                  <span className="font-medium text-ink">{s.title}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-muted" title={s.noteId}>
                    {s.noteId.slice(0, 8)}…
                  </span>
                  <button
                    type="button"
                    className="ml-2 rounded border border-line/90 bg-fill/60 px-1.5 py-px text-[11px] font-medium text-ink hover:bg-fill"
                    onClick={() => setModalSource(s)}
                  >
                    查看摘录
                  </button>
                </li>
              ))}
            </ol>
            {onlyCitedSources && visibleSources.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">正文暂无 [n] 引用角标，已自动隐藏来源列表。</p>
            ) : null}
          </div>
        </aside>
      ) : null}

      {sortedWebSources.length > 0 ? (
        <aside
          className="mt-1 border-t border-line/70 pt-3 text-xs text-ink"
          aria-label="网页参考"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg py-0.5 text-left text-ink hover:bg-fill/50"
            onClick={() => setWebSourcesOpen((o) => !o)}
            aria-expanded={webSourcesOpen}
            aria-controls="notes-ask-web-footnotes"
          >
            <span className="font-semibold">网页参考（联网检索）</span>
            <span className="shrink-0 text-[11px] font-medium text-muted">{webSourcesOpen ? "收起" : "展开"}</span>
          </button>
          <div id="notes-ask-web-footnotes" className="mt-2" hidden={!webSourcesOpen}>
            <p className="text-[11px] text-muted">
              正文中的 [w1] 等为互联网摘要角标，仅供参考；与资料库冲突时以资料库为准。点击标题在新标签页打开。
            </p>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] leading-snug">
              {sortedWebSources.map((s) => (
                <li key={s.index} id={`cite-${s.index}`} className="scroll-mt-20">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand underline break-all"
                  >
                    [{s.index}] {s.title}
                  </a>
                  {s.snippet ? <p className="mt-1 text-[11px] leading-snug text-muted">{s.snippet}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      ) : null}

      <SourceExcerptModal source={modalSource} open={modalSource != null} onClose={() => setModalSource(null)} />
    </div>
  );
}
