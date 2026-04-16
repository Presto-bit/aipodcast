"use client";

import type { ClipEditSuggestion, ClipOutlineSource } from "../../lib/prestoFlowAiSuggestions";

type Props = {
  title: string;
  empty: string;
  suggestions: ClipEditSuggestion[];
  onJumpWord?: (wordId: string) => void;
  jumpLabel: string;
  deepseekTitle?: string;
  /** 两阶段：意向（outline） */
  deepseekOutlineLabel?: string;
  deepseekOutlineBusy?: boolean;
  onLoadDeepseekOutline?: () => void;
  /** 一阶段词级结构化 */
  deepseekStructuredLabel?: string;
  deepseekStructuredBusy?: boolean;
  onLoadDeepseekStructured?: () => void;
  onExpandOutline?: (src: ClipOutlineSource) => void;
  expandOutlineLabel?: string;
  outlineExpandBusy?: boolean;
  onExecute?: (s: ClipEditSuggestion) => void;
  /** 嵌入右侧工作台抽屉时去掉侧栏边框与固定宽度 */
  embedded?: boolean;
};

export default function ClipAiSuggestionsPanel({
  title,
  empty,
  suggestions,
  onJumpWord,
  jumpLabel,
  deepseekTitle,
  deepseekOutlineLabel,
  deepseekOutlineBusy,
  onLoadDeepseekOutline,
  deepseekStructuredLabel,
  deepseekStructuredBusy,
  onLoadDeepseekStructured,
  onExpandOutline,
  expandOutlineLabel,
  outlineExpandBusy,
  onExecute,
  embedded
}: Props) {
  const llmBusy = Boolean(deepseekOutlineBusy || deepseekStructuredBusy || outlineExpandBusy);
  const wrapClass = embedded
    ? "flex min-h-0 w-full min-w-0 flex-col gap-2 overflow-y-auto bg-surface/50 p-1"
    : "flex min-h-0 w-full min-w-0 flex-col gap-2 overflow-y-auto border-l border-line bg-surface/60 p-3 lg:max-w-sm lg:shrink-0 lg:basis-[min(22rem,28vw)]";
  return (
    <aside className={wrapClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {deepseekOutlineLabel && onLoadDeepseekOutline ? (
            <button
              type="button"
              disabled={llmBusy}
              className="rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-50"
              onClick={() => onLoadDeepseekOutline()}
            >
              {deepseekOutlineBusy ? "…" : deepseekOutlineLabel}
            </button>
          ) : null}
          {deepseekStructuredLabel && onLoadDeepseekStructured ? (
            <button
              type="button"
              disabled={llmBusy}
              className="rounded-lg border border-line bg-fill px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill/80 disabled:opacity-50"
              onClick={() => onLoadDeepseekStructured()}
            >
              {deepseekStructuredBusy ? "…" : deepseekStructuredLabel}
            </button>
          ) : null}
        </div>
      </div>
      {deepseekTitle ? <p className="text-[10px] leading-relaxed text-muted">{deepseekTitle}</p> : null}
      {suggestions.length === 0 ? (
        <p className="rounded-xl border border-line bg-fill/40 p-3 text-[11px] leading-relaxed text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className={[
                "rounded-xl border p-3 text-[11px] leading-relaxed text-ink",
                s.source === "llm" ? "border-brand/30 bg-fill/30" : "border-line bg-fill/40"
              ].join(" ")}
            >
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-muted">{s.body}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {s.wordId && onJumpWord ? (
                  <button
                    type="button"
                    className="text-[10px] font-medium text-brand underline decoration-brand/40 hover:opacity-90"
                    onClick={() => onJumpWord(s.wordId!)}
                  >
                    {jumpLabel}
                  </button>
                ) : null}
                {s.outlineSource && onExpandOutline && expandOutlineLabel ? (
                  <button
                    type="button"
                    disabled={outlineExpandBusy}
                    className="rounded border border-brand/50 bg-brand/8 px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/12 disabled:opacity-50"
                    onClick={() => onExpandOutline(s.outlineSource!)}
                  >
                    {outlineExpandBusy ? "…" : expandOutlineLabel}
                  </button>
                ) : null}
                {s.execute && onExecute && s.executeLabel ? (
                  <button
                    type="button"
                    className="rounded border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-ink hover:bg-fill"
                    onClick={() => onExecute(s)}
                  >
                    {s.executeLabel}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
