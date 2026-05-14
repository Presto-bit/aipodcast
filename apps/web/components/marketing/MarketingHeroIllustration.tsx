/**
 * 营销首屏装饰：合成「工作台窗口 + 声波」示意，无外链大图，避免 LCP 依赖远程资源。
 */
export default function MarketingHeroIllustration() {
  return (
    <div
      className="relative flex aspect-[4/3] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-line/90 bg-surface/95 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)]"
      aria-hidden
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line/80 bg-fill/50 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/85" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/75" />
        <span className="ml-2 truncate text-[10px] font-medium uppercase tracking-wide text-muted">
          PrestoAI · 资料 → 播客
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,38%)_1fr] gap-0">
        <div className="min-h-0 border-r border-line/70 bg-fill/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">资料</p>
          <ul className="mt-2 space-y-1.5">
            {[72, 56, 64, 48].map((w, i) => (
              <li
                key={i}
                className="h-2 rounded bg-line/90 dark:bg-line/60"
                style={{ width: `${w}%` }}
              />
            ))}
          </ul>
        </div>
        <div className="relative flex min-h-0 flex-col justify-end bg-gradient-to-b from-brand/[0.06] to-transparent p-3 pt-6">
          <svg
            viewBox="0 0 200 72"
            className="h-auto w-full shrink-0 text-brand/85 dark:text-brand/70"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              d="M4 44c12-18 24 14 36-8s24 22 36 2 24-6 36 12 24-20 36 6 24 10 36-14"
            />
          </svg>
          <p className="mt-1 shrink-0 text-center text-[10px] text-muted">多角色成片 · Shownotes</p>
        </div>
      </div>
    </div>
  );
}
