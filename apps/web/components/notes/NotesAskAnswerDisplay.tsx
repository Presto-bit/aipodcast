"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  citationTitleForIndex,
  linkifyCitationMarkers,
  type NotesAskSource
} from "../../lib/notesAskCitation";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";

type Props = {
  text: string;
  /** 与编排器 done.sources 一致；有则 [n] 可点击并展示脚注。 */
  sources?: NotesAskSource[];
  className?: string;
};

/**
 * 将「向资料提问」的纯文本回答规范化：段间空行保留为段落，段内单行换行转为 Markdown 硬换行，便于阅读。
 */
export function normalizeNotesAskAnswerForDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/([^\n])\n(?=[^\n])/g, "$1  \n").trim())
    .join("\n\n");
}

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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
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
    </div>
  );
}

/**
 * 对话回答区：GFM Markdown + 段落/列表/代码块等排版；可选将 [n] 等标为指向脚注的内链。
 */
export function NotesAskAnswerDisplay({ text, sources, className }: Props) {
  const [modalSource, setModalSource] = useState<NotesAskSource | null>(null);

  const md = useMemo(() => {
    const n = normalizeNotesAskAnswerForDisplay(text);
    return linkifyCitationMarkers(n, sources);
  }, [text, sources]);

  const sortedSources = useMemo(() => {
    if (!sources?.length) return [];
    return [...sources].sort((a, b) => Number(a.index) - Number(b.index));
  }, [sources]);

  const wrap = className?.trim() ? className : "";

  return (
    <div
      className={`notes-ask-answer flex min-w-0 flex-col gap-3 text-sm leading-relaxed text-ink [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink/90 [&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.8125rem] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line/80 [&_pre]:bg-fill/80 [&_pre]:p-3 [&_pre]:text-xs [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_td]:border [&_td]:border-line/70 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-line/70 [&_th]:bg-fill/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5 ${wrap}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="min-w-0 whitespace-pre-wrap">{children}</p>,
          a: ({ href, children, ...rest }) => {
            const rawHref = String(href || "");
            if (rawHref.startsWith("#cite-")) {
              const idx = rawHref.replace(/^#cite-/, "");
              const title = citationTitleForIndex(sources, idx);
              return (
                <a
                  href={rawHref}
                  className="ml-0.5 inline align-baseline text-[0.92em] font-semibold text-brand underline decoration-dotted underline-offset-[3px] hover:decoration-solid"
                  title={title}
                  {...rest}
                >
                  {children}
                </a>
              );
            }
            const safe = sanitizeUserMarkdownHref(href);
            if (!safe) {
              return <span className="break-all text-ink">{children}</span>;
            }
            return (
              <a href={safe} className="break-all text-brand underline" target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
          code: ({ className: codeClass, children }) =>
            codeClass ? (
              <pre>
                <code>{children}</code>
              </pre>
            ) : (
              <code>{children}</code>
            )
        }}
      >
        {md || "（无内容）"}
      </ReactMarkdown>

      {sortedSources.length > 0 ? (
        <aside
          className="mt-1 border-t border-line/70 pt-3 text-xs text-ink"
          aria-label="引用来源"
        >
          <p className="font-semibold text-ink">引用来源</p>
          <p className="mt-1 text-[11px] text-muted">
            点击正文中的 [n] 可跳转到下方对应脚注；有检索摘录时点击「查看摘录」可在弹窗中阅读块原文。
          </p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] leading-snug">
            {sortedSources.map((s) => (
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
        </aside>
      ) : null}

      <SourceExcerptModal source={modalSource} open={modalSource != null} onClose={() => setModalSource(null)} />
    </div>
  );
}
