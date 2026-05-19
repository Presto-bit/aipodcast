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
  /** 联网检索条目，[w1] 外链与脚注 */
  webSources?: NotesAskWebSource[];
  /** 在资料预览中高亮定位（charStart/charEnd 来自检索块） */
  onOpenSourceInPreview?: (source: NotesAskSource, chunk?: { charStart?: number; charEnd?: number; excerpt?: string }) => void;
  lowConfidence?: boolean;
  className?: string;
};

export { normalizeNotesAskAnswerForDisplay } from "../../lib/notesAskAnswerNormalize";

function SourceExcerptModal({
  source,
  open,
  onClose,
  onOpenInPreview
}: {
  source: NotesAskSource | null;
  open: boolean;
  onClose: () => void;
  onOpenInPreview?: (source: NotesAskSource, chunk?: { charStart?: number; charEnd?: number; excerpt?: string }) => void;
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
            参考资料 [{source.index}] {source.title}
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
                  {onOpenInPreview &&
                  (typeof c.charStart === "number" || (c.excerpt && c.excerpt.length > 0)) ? (
                    <button
                      type="button"
                      className="mt-2 rounded border border-brand/40 bg-brand/5 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10"
                      onClick={() => {
                        onOpenInPreview(source, {
                          charStart: c.charStart,
                          charEnd: c.charEnd,
                          excerpt: c.excerpt
                        });
                        onClose();
                      }}
                    >
                      在原文中定位
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">本条暂无向量检索摘录，请以正文角标对应资料中的参考资料全文为准。</p>
          )}
        </div>
        <div className="border-t border-line/80 flex justify-end gap-2 px-4 py-2.5">
          {onOpenInPreview && source ? (
            <button
              type="button"
              className="rounded-md border border-brand/40 bg-brand/5 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
              onClick={() => {
                const c0 = source.chunks?.[0];
                onOpenInPreview(source, {
                  charStart: c0?.charStart,
                  charEnd: c0?.charEnd,
                  excerpt: c0?.excerpt
                });
                onClose();
              }}
            >
              打开资料预览
            </button>
          ) : null}
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
export function NotesAskAnswerDisplay({
  text,
  sources,
  webSources,
  onOpenSourceInPreview,
  lowConfidence,
  className
}: Props) {
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

  const wrap = className?.trim() ? className : "";

  return (
    <div className={`notes-ask-answer flex min-w-0 flex-col gap-3 text-ink ${wrap}`}>
      {lowConfidence ? (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning-ink">
          检索置信度偏低，请与原文核对；可开启「严谨引用」或缩小提问范围。
        </p>
      ) : null}
      <NotesAskAnswerMarkdownBody
        text={text}
        sources={sources}
        webSources={webSources}
        onCitationClick={(index) => {
          const src = sortedSources.find((s) => s.index === index);
          if (src) setModalSource(src);
        }}
      />

      {sortedSources.length > 0 ? (
        <aside
          className="mt-1 border-t border-line/70 pt-3 text-xs text-ink"
          aria-label="引用参考资料"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg py-0.5 text-left text-ink hover:bg-fill/50"
            onClick={() => setSourcesOpen((o) => !o)}
            aria-expanded={sourcesOpen}
            aria-controls="notes-ask-citation-footnotes"
          >
            <span className="font-semibold">
              引用参考资料（资料库）
              <span className="ml-1.5 font-normal text-muted">· {visibleSources.length} 条</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-muted">{sourcesOpen ? "收起" : "展开"}</span>
          </button>
          {sourcesOpen ? (
          <div id="notes-ask-citation-footnotes" className="mt-2">
            <p className="text-[11px] text-muted">
              点击正文中的 [n] 可查看对应检索摘录（弹窗）；关键处若出现「」短引文，可与下方脚注对照。与网页摘要冲突时以资料库为准。
            </p>
            {citedSourceIndexes.size > 0 ? (
              <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-line"
                  checked={onlyCitedSources}
                  onChange={(e) => setOnlyCitedSources(e.target.checked)}
                />
                仅显示正文已引用的参考资料
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
              <p className="mt-2 text-[11px] text-muted">正文暂无 [n] 引用角标，已自动隐藏参考资料列表。</p>
            ) : null}
          </div>
          ) : null}
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
          {webSourcesOpen ? (
            <div id="notes-ask-web-footnotes" className="mt-2">
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
          ) : null}
        </aside>
      ) : null}

      <SourceExcerptModal
        source={modalSource}
        open={modalSource != null}
        onClose={() => setModalSource(null)}
        onOpenInPreview={onOpenSourceInPreview}
      />
    </div>
  );
}
