/**
 * 营销首屏装饰：无远程大图。叙事为「资料源 → 对话与引用 → 声波 → 多形态输出」。
 */
export default function MarketingHeroIllustration() {
  return (
    <div
      className="relative flex aspect-[5/4] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-line/90 bg-surface/95 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)] sm:aspect-[4/3]"
      aria-hidden
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line/80 bg-fill/50 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/85" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/75" />
        <span className="ml-1.5 min-w-0 truncate text-[10px] font-semibold tracking-tight text-ink/90 sm:text-[11px]">
          PrestoAI · 上传资料 → 创作→文章/播客
        </span>
      </div>

      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,36%)_1fr] gap-0">
        <div
          className="absolute bottom-3 left-[36%] top-11 z-0 w-px bg-gradient-to-b from-transparent via-brand/25 to-brand/10"
          aria-hidden
        />
        <div className="relative z-[1] min-h-0 border-r border-line/70 bg-fill/35 p-2.5 sm:p-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted">资料源</p>
          <ul className="mt-1.5 space-y-1.5 sm:mt-2 sm:space-y-2">
            {[
              { t: "电子书", s: "PDF" },
              { t: "网页", s: "URL" },
              { t: "文档", s: "DOC" },
              { t: "你的观点", s: "Ideas" }
            ].map((row) => (
              <li
                key={row.t}
                className="flex items-center justify-between gap-1 rounded-md border border-line/60 bg-surface/80 px-1.5 py-0.5 text-[9px] text-ink/90 sm:py-1 sm:text-[10px]"
              >
                <span className="truncate font-medium">{row.t}</span>
                <span className="shrink-0 rounded bg-brand/12 px-1 py-px text-[8px] font-semibold text-brand sm:text-[9px]">
                  {row.s}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[9px] leading-snug text-muted sm:mt-2">基于可信资料，减少 AI 幻觉</p>
        </div>

        <div className="relative z-[1] flex min-h-0 flex-col bg-gradient-to-br from-brand/[0.07] via-transparent to-transparent p-2.5 sm:p-3">
          <div className="rounded-lg border border-line/70 bg-surface/90 p-2 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
            <p className="text-[9px] font-semibold text-muted">对话</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink/85">
              要点摘要与跨文档关联……
              <sup className="ml-0.5 font-bold text-brand">[1]</sup>
              <sup className="font-bold text-brand">[2]</sup>
            </p>
          </div>

          <div className="mt-auto pt-3">
            <svg
              viewBox="0 0 200 64"
              className="h-12 w-full text-brand/80 dark:text-brand/65 sm:h-14"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                d="M2 40c10-16 20 12 30-10s20 18 30 0 20-4 30 10 20-14 30 4 20 8 30-10 20 6 28-4"
              />
            </svg>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {["文章", "播客", "Shownotes"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[9px] font-semibold text-brand dark:border-brand/30 dark:bg-brand/15"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
