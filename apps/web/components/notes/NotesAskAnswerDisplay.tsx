"use client";

import { useMemo } from "react";
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

/**
 * 对话回答区：GFM Markdown + 段落/列表/代码块等排版；可选将 [1] 等标为指向脚注的内链。
 */
export function NotesAskAnswerDisplay({ text, sources, className }: Props) {
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
          <p className="mt-1 text-[11px] text-muted">点击正文中带下划线的 [n] 可跳转到对应条目。</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] leading-snug">
            {sortedSources.map((s) => (
              <li key={`${s.noteId}-${s.index}`} id={`cite-${s.index}`} className="scroll-mt-20">
                <span className="font-medium text-ink">{s.title}</span>
                <span className="ml-1.5 font-mono text-[10px] text-muted" title={s.noteId}>
                  {s.noteId.slice(0, 8)}…
                </span>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </div>
  );
}
