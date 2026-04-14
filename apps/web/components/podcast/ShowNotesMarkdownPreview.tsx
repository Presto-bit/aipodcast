"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sanitizeUserMarkdownHref } from "../../lib/safeMarkdownHref";

type Props = {
  markdown: string;
  /** 点击 `[文案](t:秒)` 时跳转播放器；未提供则时间戳为纯链接样式（不可点） */
  onSeekSeconds?: (sec: number) => void;
  className?: string;
};

/**
 * Show Notes 预览：GFM Markdown + `[显示](t:123)` 时间戳（秒）跳转；标题层级用于章节结构。
 */
export function ShowNotesMarkdownPreview({ markdown, onSeekSeconds, className }: Props) {
  const baseClass =
    "max-h-48 overflow-y-auto rounded-lg border border-line bg-fill/40 px-2 py-2 text-sm text-ink [&_a]:text-brand [&_a]:underline [&_button]:text-left [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1";
  return (
    <div className={className ? `${baseClass} ${className}` : baseClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children, ...rest }) {
            return (
              <h1 className="mt-3 border-b border-line pb-1 text-base font-semibold text-ink first:mt-0" {...rest}>
                {children}
              </h1>
            );
          },
          h2({ children, ...rest }) {
            return (
              <h2 className="mt-3 border-b border-line/80 pb-0.5 text-[15px] font-semibold text-ink first:mt-0" {...rest}>
                {children}
              </h2>
            );
          },
          h3({ children, ...rest }) {
            return (
              <h3 className="mt-2 text-sm font-semibold text-ink first:mt-0" {...rest}>
                {children}
              </h3>
            );
          },
          a({ href, children, ...rest }) {
            const h = String(href || "");
            if (h.startsWith("t:")) {
              const sec = Number.parseInt(h.slice(2), 10);
              if (Number.isFinite(sec) && sec >= 0 && onSeekSeconds) {
                return (
                  <button
                    type="button"
                    className="cursor-pointer text-brand underline decoration-dotted underline-offset-2 hover:opacity-90"
                    onClick={() => onSeekSeconds(sec)}
                  >
                    {children}
                  </button>
                );
              }
              return <span className="text-brand/90 underline decoration-dotted">{children}</span>;
            }
            const safe = sanitizeUserMarkdownHref(h);
            if (!safe) {
              return <span className="break-all text-ink">{children}</span>;
            }
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer" className="break-all" {...rest}>
                {children}
              </a>
            );
          }
        }}
      >
        {markdown.trim() ? markdown : "*（暂无内容）*"}
      </ReactMarkdown>
    </div>
  );
}
