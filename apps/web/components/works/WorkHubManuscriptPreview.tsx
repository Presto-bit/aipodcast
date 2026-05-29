"use client";

import { useMemo } from "react";
import { manuscriptBodyToDisplaySections } from "../../lib/manuscriptBodyDisplay";

type Props = {
  body: string;
  emptyHint?: string;
  className?: string;
  /** false 时由父级统一滚动，不单独限高 */
  scrollContained?: boolean;
};

/**
 * 文稿只读预览：连续正文区，小节标题 inline，整体可滚动。
 */
export function WorkHubManuscriptPreview({
  body,
  emptyHint,
  className = "",
  scrollContained = true
}: Props) {
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

  const scrollCls = scrollContained ? "max-h-[min(85vh,48rem)] overflow-y-auto" : "";

  if (!multiSection) {
    return (
      <div
        className={`${scrollCls} whitespace-pre-wrap [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm ${className}`.trim()}
      >
        {trimmed}
      </div>
    );
  }

  return (
    <div
      className={`${scrollCls} [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm ${className}`.trim()}
    >
      {sections.map((section, index) => (
        <div key={`${index}-${section.heading.slice(0, 24)}`} className={index > 0 ? "mt-5" : ""}>
          {section.heading ? (
            <h4 className="text-sm font-semibold leading-snug text-ink sm:text-[15px]">{section.heading}</h4>
          ) : null}
          {section.content ? (
            <p className={`whitespace-pre-wrap ${section.heading ? "mt-2" : ""}`}>{section.content}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
