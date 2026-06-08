"use client";

import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_META,
  STUDIO_MANUSCRIPT_TITLE,
  STUDIO_STREAM_CURSOR
} from "../../lib/studioOutputTypography";
import {
  manuscriptTitleBlocks,
  parseManuscriptBodySegments,
  studioTitleDirectionHint,
  studioTitleDirectionLabel,
  type ManuscriptVariantSlice
} from "../../lib/studioManuscriptView";

export function StudioVariantTabs({
  titles,
  titleIndex,
  onTitleIndexChange
}: {
  titles: ReturnType<typeof manuscriptTitleBlocks>;
  titleIndex: number;
  onTitleIndexChange: (index: number) => void;
}) {
  if (titles.length <= 1) return null;

  return (
    <div
      className="mb-3 inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-line/60 bg-fill/25 p-1"
      role="tablist"
      aria-label="切换写作方向"
    >
      {titles.map((t, i) => {
        const active = i === titleIndex;
        const hint = studioTitleDirectionHint(i, t);
        const label = studioTitleDirectionLabel(i, t);
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={hint ? `${label} · ${hint} · ${t.text}` : t.text}
            className={[
              "rounded-md px-3 py-1.5 text-left text-xs transition",
              active
                ? "bg-surface font-medium text-ink shadow-sm ring-1 ring-line/40"
                : "text-muted hover:bg-surface/60 hover:text-ink"
            ].join(" ")}
            onClick={() => onTitleIndexChange(i)}
          >
            <span>{label}</span>
            {hint ? (
              <span className={`mt-0.5 block text-[10px] leading-snug ${active ? "text-muted" : "text-muted/80"}`}>
                {hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ManuscriptBodySegments({ body }: { body: string }) {
  const segments = parseManuscriptBodySegments(body);
  if (!segments.length) return null;

  return (
    <div className="space-y-3">
      {segments.map((seg, i) => {
        if (seg.kind === "list") {
          return (
            <ul key={i} className={`${STUDIO_MANUSCRIPT_BODY} list-none space-y-1.5 pl-0`}>
              {seg.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="shrink-0 text-muted">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={STUDIO_MANUSCRIPT_BODY}>
            {seg.text}
          </p>
        );
      })}
    </div>
  );
}

export default function StudioManuscriptReadable({
  variant,
  showTitle = true,
  trailingCursor = false,
  className = ""
}: {
  variant: ManuscriptVariantSlice;
  showTitle?: boolean;
  trailingCursor?: boolean;
  className?: string;
}) {
  const hasBody = Boolean(variant.body.trim());
  const hasTail = Boolean(variant.interaction.trim() || variant.hashtags.length || variant.cover.trim());

  if (!showTitle && !hasBody && !hasTail) return null;

  return (
    <article className={`min-w-0 select-text text-left ${className}`.trim()}>
      {showTitle && variant.title.trim() ? (
        <h2 className={STUDIO_MANUSCRIPT_TITLE}>{variant.title.trim()}</h2>
      ) : null}

      {hasBody ? (
        <div className={showTitle && variant.title.trim() ? "mt-3" : ""}>
          <ManuscriptBodySegments body={variant.body} />
        </div>
      ) : null}

      {variant.interaction.trim() ? (
        <p className={`${hasBody ? "mt-4" : "mt-0"} text-sm leading-relaxed text-ink/90`}>
          {variant.interaction.trim()}
        </p>
      ) : null}

      {variant.hashtags.length ? (
        <p className={`mt-3 ${STUDIO_MANUSCRIPT_HASHTAGS}`}>
          {variant.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
        </p>
      ) : null}

      {variant.cover.trim() ? (
        <p className={`mt-2 ${STUDIO_MANUSCRIPT_META}`}>封面：{variant.cover.trim()}</p>
      ) : null}

      {trailingCursor ? (
        <p className={`mt-2 ${STUDIO_MANUSCRIPT_BODY}`}>
          <span className={STUDIO_STREAM_CURSOR} aria-hidden />
        </p>
      ) : null}
    </article>
  );
}
