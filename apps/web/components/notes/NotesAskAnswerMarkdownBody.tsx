"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
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
  onCitationClick?: (index: string) => void;
  onWebCitationClick?: () => void;
};

function fencePlainText(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(fencePlainText).join("");
  if (typeof children === "object" && "props" in children) {
    const el = children as { props?: { children?: ReactNode } };
    return fencePlainText(el.props?.children);
  }
  return String(children);
}

function FenceCodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const text = fencePlainText(children).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  const langMatch = /language-([\w-]+)/.exec(className || "");
  const lang = langMatch?.[1] || "text";

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-line/90 bg-fill/50 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 bg-fill/80 px-2.5 py-1.5">
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-wide text-muted">{lang}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line/80 bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-fill"
          aria-label={copied ? "已复制" : "复制代码"}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-success-ink" aria-hidden />
              已复制
            </>
          ) : (
            <>
              <Copy className="size-3.5 text-muted" aria-hidden />
              复制
            </>
          )}
        </button>
      </div>
      <pre className="m-0 max-h-[min(70vh,28rem)] overflow-x-auto overflow-y-auto p-3 font-mono text-[12px] leading-relaxed text-ink">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

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
  if (!md.trim()) {
    return null;
  }
  return (
    <article className="notes-ask-answer-md min-w-0 text-[14px] leading-[1.65] text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-0 scroll-mt-20 text-[17px] font-semibold tracking-tight text-ink">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-7 scroll-mt-20 border-b border-line/60 pb-1.5 text-[15px] font-semibold text-ink first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-5 scroll-mt-20 text-sm font-semibold text-ink first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-4 scroll-mt-20 text-sm font-semibold text-ink/95 first:mt-0">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="mb-1 mt-3 text-[13px] font-semibold text-ink/90 first:mt-0">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="mb-1 mt-3 text-[13px] font-medium text-muted first:mt-0">{children}</h6>
          ),
          p: ({ children }) => <p className="mb-3 min-w-0 whitespace-pre-wrap last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-outside list-disc space-y-1 pl-[1.2em] marker:text-muted last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-outside list-decimal space-y-1 pl-[1.35em] marker:text-muted last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5 [&>p]:mb-2 [&>p]:last:mb-0">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 rounded-r-lg border-l-[3px] border-brand/40 bg-brand/[0.07] py-2 pl-3 pr-2 text-[13.5px] leading-relaxed text-ink/92 last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-0 border-t border-line/80" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-line/80 last:mb-0">
              <table className="w-full min-w-[12rem] border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-fill/70">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-line/50 last:border-b-0">{children}</tr>,
          th: ({ children }) => (
            <th className="border border-line/60 px-2.5 py-2 text-left text-xs font-semibold text-ink">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-line/60 px-2.5 py-1.5 align-top text-[13px] text-ink/95">{children}</td>
          ),
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic text-ink/95">{children}</em>,
          pre: ({ children }) => <>{children}</>,
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
                      onCitationClick?.(idx);
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
              <a
                href={safe}
                className="break-all text-brand underline"
                target="_blank"
                rel="noopener noreferrer"
                {...rest}
              >
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const cls = String(className || "");
            const hasLang = /language-/.test(cls);
            const raw = fencePlainText(children);
            const isBlock = hasLang || raw.includes("\n");
            if (!isBlock) {
              return (
                <code className="rounded bg-fill/90 px-1 py-px font-mono text-[0.8125rem] text-ink [overflow-wrap:anywhere]">
                  {children}
                </code>
              );
            }
            return <FenceCodeBlock className={className}>{children}</FenceCodeBlock>;
          }
        }}
      >
        {md}
      </ReactMarkdown>
    </article>
  );
}
