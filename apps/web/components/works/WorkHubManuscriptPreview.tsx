"use client";

import { useMemo } from "react";
import { manuscriptBodyToDisplaySections } from "../../lib/manuscriptBodyDisplay";

type Props = {
  body: string;
  emptyHint?: string;
  className?: string;
};

/**
 * 文稿只读预览：结构化小节（heading/content、## 标题）或纯文本。
 */
export function WorkHubManuscriptPreview({ body, emptyHint, className = "" }: Props) {
  const sections = useMemo(() => manuscriptBodyToDisplaySections(body), [body]);
  const trimmed = String(body || "").trim();

  if (!trimmed) {
    return (
      <p className={`text-[13px] text-muted sm:text-sm ${className}`.trim()}>
        {emptyHint?.trim() || "（无正文）"}
      </p>
    );
  }

  const multiSection = sections.length > 1 || Boolean(sections[0]?.heading);

  if (!multiSection) {
    return (
      <div
        className={`max-h-[min(80vh,36rem)] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-fill/20 p-3 [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm ${className}`.trim()}
      >
        {trimmed}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      {sections.map((section, index) => (
        <article
          key={`${index}-${section.heading.slice(0, 24)}`}
          className="rounded-xl border border-line/70 bg-fill/25 px-3 py-3 sm:px-4"
        >
          {section.heading ? (
            <h4 className="border-l-2 border-brand/70 pl-2.5 text-sm font-semibold leading-snug text-ink sm:text-[15px]">
              {section.heading}
            </h4>
          ) : null}
          {section.content ? (
            <p
              className={`whitespace-pre-wrap [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm ${
                section.heading ? "mt-2.5" : ""
              }`}
            >
              {section.content}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
