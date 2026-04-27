"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";

type Props = { filteredText: string };

/** 笔记预览正文：与 NoteMarkdownPreview 拆 chunk，按需加载 react-markdown。 */
export default function NoteMarkdownDoc({ filteredText }: Props) {
  const H = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
    const className =
      Tag === "h1"
        ? "mt-4 text-lg font-bold text-ink"
        : Tag === "h2"
          ? "mt-3 text-base font-semibold text-ink"
          : "mt-2 text-sm font-medium text-ink";
    const Comp = (props: { children?: React.ReactNode }) =>
      React.createElement(Tag, { className }, props.children);
    return Comp;
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: H("h1"),
        h2: H("h2"),
        h3: H("h3"),
        h4: H("h4"),
        h5: H("h5"),
        h6: H("h6"),
        p: ({ children }) => <p className="mb-2 text-sm leading-relaxed text-ink">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-inside list-disc text-sm text-ink">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-inside list-decimal text-sm text-ink">{children}</ol>,
        code: ({ className, children }) =>
          className ? (
            <pre className="mb-2 overflow-x-auto rounded bg-fill p-2 text-xs">
              <code>{children}</code>
            </pre>
          ) : (
            <code className="rounded bg-track px-1 text-xs">{children}</code>
          ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-4 border-line pl-3 text-sm text-ink">{children}</blockquote>
        ),
        a: ({ href, children }) => {
          const safe = sanitizeUserMarkdownHref(href);
          if (!safe) {
            return <span className="text-ink underline decoration-line">{children}</span>;
          }
          return (
            <a href={safe} className="text-brand underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
      }}
    >
      {filteredText}
    </ReactMarkdown>
  );
}
