"use client";

import React, { useMemo, useRef } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";

type Props = {
  filteredText: string;
  headingIdPrefix?: string;
  /** prose：长文阅读；table：表格资料 */
  variant?: "prose" | "table";
};

function nodeText(children: React.ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (typeof children === "object" && "props" in children) {
    const el = children as { props?: { children?: React.ReactNode } };
    return nodeText(el.props?.children);
  }
  return "";
}

function slugifyHeading(s: string): string {
  const base = s
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return base || "section";
}

/** 笔记阅读正文：与 NoteMarkdownPreview 拆 chunk，按需加载 react-markdown。 */
export default function NoteMarkdownDoc({
  filteredText,
  headingIdPrefix = "note-preview",
  variant = "prose"
}: Props) {
  const isTable = variant === "table";
  const headingCountRef = useRef<Record<string, number>>({});
  headingCountRef.current = {};
  const H = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
    const className = isTable
      ? Tag === "h2"
        ? "mb-2 mt-4 scroll-mt-4 text-sm font-semibold text-ink"
        : "mb-1 mt-3 text-sm font-medium text-ink"
      : Tag === "h1"
        ? "mb-4 mt-8 scroll-mt-4 text-2xl font-bold text-ink"
        : Tag === "h2"
          ? "mb-3 mt-6 scroll-mt-4 text-xl font-semibold text-ink"
          : Tag === "h3"
            ? "mb-2 mt-5 scroll-mt-4 text-lg font-medium text-ink"
            : "mb-2 mt-4 scroll-mt-4 text-base font-medium text-ink";
    const Comp = (props: { children?: React.ReactNode }) => {
      const txt = nodeText(props.children);
      const slug = slugifyHeading(txt);
      const n = (headingCountRef.current[slug] || 0) + 1;
      headingCountRef.current[slug] = n;
      const id = `${headingIdPrefix}-${slug}${n > 1 ? `-${n}` : ""}`;
      return React.createElement(Tag, { className, id }, props.children);
    };
    return Comp;
  };
  const markdown = useMemo(() => filteredText, [filteredText]);
  const pClass = isTable ? "mb-2 text-sm leading-relaxed text-ink" : "mb-4 text-[17px] leading-[1.8] text-ink";
  const listClass = isTable ? "mb-2 list-inside list-disc text-sm text-ink" : "mb-3 list-inside list-disc text-[17px] text-ink";
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
        p: ({ children }) => <p className={pClass}>{children}</p>,
        ul: ({ children }) => <ul className={listClass}>{children}</ul>,
        ol: ({ children }) => (
          <ol className={isTable ? listClass.replace("disc", "decimal") : "mb-3 list-inside list-decimal text-[17px] text-ink"}>
            {children}
          </ol>
        ),
        code: ({ className, children }) =>
          className ? (
            <pre className="mb-2 overflow-x-auto rounded bg-fill p-2 text-xs">
              <code>{children}</code>
            </pre>
          ) : (
            <code className="rounded bg-track px-1 text-xs">{children}</code>
          ),
        blockquote: ({ children }) => (
          <blockquote
            className={
              isTable
                ? "mb-2 border-l-4 border-line pl-3 text-sm text-ink"
                : "mb-4 border-l-4 border-line/80 pl-4 text-[17px] italic text-ink/90"
            }
          >
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="mb-3 overflow-x-auto rounded-lg border border-line/70">
            <table
              className={
                isTable
                  ? "min-w-full border-collapse text-sm text-ink [&_tbody_tr:nth-child(even)]:bg-fill/30 [&_th]:sticky [&_th]:top-0 [&_th]:z-[1]"
                  : "min-w-full border-collapse text-sm text-ink"
              }
            >
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th
            className={
              isTable
                ? "border border-line/60 bg-fill px-2 py-1.5 text-left text-xs font-semibold"
                : "border border-line/60 bg-fill/40 px-2 py-1 text-left"
            }
          >
            {children}
          </th>
        ),
        td: ({ children }) => <td className="border border-line/60 px-2 py-1 align-top text-sm">{children}</td>,
        img: ({ src, alt }) => {
          const safe = sanitizeUserMarkdownHref(src);
          if (!safe) return null;
          return (
            <Image
              src={safe}
              alt={String(alt || "")}
              width={1200}
              height={800}
              unoptimized
              loading="lazy"
              className="my-2 h-auto max-w-full rounded-lg border border-line/50"
            />
          );
        },
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
      {markdown}
    </ReactMarkdown>
  );
}
