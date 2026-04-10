"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
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
 * 对话回答区：GFM Markdown + 段落/列表/代码块等排版。
 */
export function NotesAskAnswerDisplay({ text, className }: Props) {
  const md = normalizeNotesAskAnswerForDisplay(text);
  const wrap = className?.trim() ? className : "";

  return (
    <div
      className={`notes-ask-answer flex min-w-0 flex-col gap-3 text-sm leading-relaxed text-ink [&_a]:break-all [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink/90 [&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.8125rem] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line/80 [&_pre]:bg-fill/80 [&_pre]:p-3 [&_pre]:text-xs [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_td]:border [&_td]:border-line/70 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-line/70 [&_th]:bg-fill/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5 ${wrap}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="min-w-0 whitespace-pre-wrap">{children}</p>,
          a: ({ href, children, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          ),
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
    </div>
  );
}
