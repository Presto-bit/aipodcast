"use client";

import type { MouseEventHandler } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  citationTitleForIndex,
  citationTitleForWebIndex,
  linkifyCitationMarkers,
  linkifyWebCitationMarkers,
  type NotesAskSource,
  type NotesAskWebSource
} from "../../lib/notesAskCitation";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";
import { normalizeNotesAskAnswerForDisplay } from "../../lib/notesAskAnswerNormalize";

export type NotesAskAnswerMarkdownBodyProps = {
  text: string;
  sources?: NotesAskSource[];
  webSources?: NotesAskWebSource[];
  onCitationClick?: () => void;
  onWebCitationClick?: () => void;
};

/**
 * 按需动态加载的 Markdown 正文（react-markdown + remark-gfm），与父组件拆 chunk。
 */
export default function NotesAskAnswerMarkdownBody({
  text,
  sources,
  webSources,
  onCitationClick,
  onWebCitationClick
}: NotesAskAnswerMarkdownBodyProps) {
  const normalized = normalizeNotesAskAnswerForDisplay(text);
  const md = linkifyWebCitationMarkers(linkifyCitationMarkers(normalized, sources), webSources);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="min-w-0 whitespace-pre-wrap">{children}</p>,
        a: ({ href, children, ...rest }) => {
          const rawHref = String(href || "");
          if (rawHref.startsWith("#cite-w")) {
            const widx = rawHref.replace(/^#cite-/, "");
            const ws = webSources?.find((x) => x.index === widx);
            const title = citationTitleForWebIndex(webSources, widx);
            if (ws?.url) {
              return (
                <a
                  href={ws.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-0.5 inline align-baseline text-[0.92em] font-semibold text-brand underline decoration-dotted underline-offset-[3px] hover:decoration-solid"
                  title={title}
                  {...rest}
                  onClick={(e) => {
                    onWebCitationClick?.();
                    (rest as { onClick?: MouseEventHandler<HTMLAnchorElement> }).onClick?.(e);
                  }}
                >
                  {children}
                </a>
              );
            }
          }
          if (rawHref.startsWith("#cite-")) {
            const idx = rawHref.replace(/^#cite-/, "");
            if (/^w\d+$/i.test(idx)) {
              return <span className="ml-0.5 text-brand">{children}</span>;
            }
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
