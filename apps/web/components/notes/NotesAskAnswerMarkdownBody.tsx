"use client";

import type { MouseEventHandler } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationTitleForIndex, linkifyCitationMarkers, type NotesAskSource } from "../../lib/notesAskCitation";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";
import { normalizeNotesAskAnswerForDisplay } from "../../lib/notesAskAnswerNormalize";

export type NotesAskAnswerMarkdownBodyProps = {
  text: string;
  sources?: NotesAskSource[];
  onCitationClick?: () => void;
};

/**
 * 按需动态加载的 Markdown 正文（react-markdown + remark-gfm），与父组件拆 chunk。
 */
export default function NotesAskAnswerMarkdownBody({
  text,
  sources,
  onCitationClick
}: NotesAskAnswerMarkdownBodyProps) {
  const md = linkifyCitationMarkers(normalizeNotesAskAnswerForDisplay(text), sources);
  return (
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
                onClick={(e) => {
                  onCitationClick?.();
                  (rest as { onClick?: MouseEventHandler<HTMLAnchorElement> }).onClick?.(e);
                }}
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
  );
}
