import { Fragment, type ReactNode } from "react";

/**
 * 营销首屏装饰：无远程大图。叙事为「多源资料 → PrestoAI 分析对话 → 多形态输出」。
 */
function InputSourceCard({
  label,
  tagClass,
  children
}: {
  label: string;
  tagClass: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex aspect-square w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-line/70 bg-surface/95 px-1 py-1.5 shadow-sm sm:w-[4.75rem] md:w-full md:max-w-[5.25rem] md:py-2">
      <span
        className={`pointer-events-none absolute right-0 top-0 h-0 w-0 rounded-tr-xl border-l-[11px] border-l-transparent border-t-[11px] border-t-transparent sm:border-l-[12px] sm:border-t-[12px] ${tagClass}`}
        aria-hidden
      />
      <span className="flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">{children}</span>
      <span className="text-center text-[9px] font-semibold leading-none text-ink/90 sm:text-[10px]">{label}</span>
    </li>
  );
}

function OutputCard({
  label,
  tagClass,
  children
}: {
  label: string;
  tagClass: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex aspect-square w-[4.75rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-line/70 bg-surface/95 px-1 py-1.5 shadow-sm sm:w-[5.25rem] md:w-full md:max-w-[5.75rem] md:py-2">
      <span
        className={`pointer-events-none absolute right-0 top-0 h-0 w-0 rounded-tr-xl border-l-[11px] border-l-transparent border-t-[11px] border-t-transparent sm:border-l-[12px] sm:border-t-[12px] ${tagClass}`}
        aria-hidden
      />
      <span className="flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9">{children}</span>
      <span className="text-center text-[9px] font-semibold leading-none text-ink/90 sm:text-[10px]">{label}</span>
    </li>
  );
}

function FlowArrows({ className = "" }: { className?: string }) {
  return (
    <svg className={`pointer-events-none text-line/55 ${className}`} viewBox="0 0 120 160" fill="none" aria-hidden>
      <path
        d="M8 24 Q52 40 52 78 M52 78 Q52 116 8 132"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M112 24 Q68 40 68 78 M68 78 Q68 116 112 132"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <polygon points="52,82 48,76 56,76" fill="currentColor" opacity="0.5" />
      <polygon points="68,82 64,76 72,76" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export default function MarketingHeroIllustration() {
  return (
    <div
      className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-line/90 bg-surface/95 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)]"
      aria-hidden
    >
      <div className="pointer-events-none absolute left-[8%] top-6 text-brand/25 sm:left-[10%] sm:top-8" aria-hidden>
        <span className="text-sm font-light">+</span>
      </div>
      <div className="pointer-events-none absolute right-[12%] top-10 text-amber-400/35" aria-hidden>
        <span className="text-xs font-light">+</span>
      </div>

      <div className="relative px-3 pb-4 pt-3 sm:px-4 sm:pb-5 sm:pt-4">
        <div className="grid grid-cols-1 items-center gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,1fr)] md:gap-2 lg:gap-3">
          {/* 左侧：资料源 */}
          <ul className="mx-auto flex max-w-full flex-row flex-wrap justify-center gap-2 md:mx-0 md:flex-col md:items-center md:justify-center md:gap-2.5 md:py-1">
            <InputSourceCard label="PDF" tagClass="border-t-danger/90">
              <svg viewBox="0 0 24 24" className="h-full w-full text-danger/90" aria-hidden>
                <path
                  fill="currentColor"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4zM8 18V6h4v6h6v6H8z"
                />
              </svg>
            </InputSourceCard>
            <InputSourceCard label="Word" tagClass="border-t-blue-600">
              <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
                <path
                  fill="currentColor"
                  className="text-blue-600"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4z"
                />
                <path className="fill-surface" d="M8 8h8v10H8z" />
                <text
                  x="12"
                  y="16.25"
                  textAnchor="middle"
                  className="fill-blue-700 font-bold dark:fill-blue-400"
                  style={{ fontSize: "8.5px" }}
                >
                  W
                </text>
              </svg>
            </InputSourceCard>
            <InputSourceCard label="网页" tagClass="border-t-sky-500">
              <svg viewBox="0 0 24 24" className="h-full w-full text-sky-500" aria-hidden>
                <path
                  fill="currentColor"
                  d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm7.93 9h-3.12a15.8 15.8 0 0 0-.69-4A8.05 8.05 0 0 1 19.93 11zM12 4a13.6 13.6 0 0 1 2.5 3H9.5A13.6 13.6 0 0 1 12 4zM8.88 7h6.24a14.5 14.5 0 0 1 .56 4H8.32a14.5 14.5 0 0 1 .56-4zM4.07 11a8.05 8.05 0 0 1 3.88-4 15.8 15.8 0 0 0-.69 4H4.07zM8.32 13h7.36a14.5 14.5 0 0 1-.56 4H8.88a14.5 14.5 0 0 1-.56-4zm1.56 6h4.24a13.6 13.6 0 0 1-2.5 3 13.6 13.6 0 0 1-2.5-3zm6.62-2a15.8 15.8 0 0 0 .69 4 8.05 8.05 0 0 1-3.88-4h3.19zm.69-8a15.8 15.8 0 0 0-.69-4 8.05 8.05 0 0 1 3.88 4h-3.19z"
                />
              </svg>
            </InputSourceCard>
            <InputSourceCard label="Excel" tagClass="border-t-emerald-600">
              <svg viewBox="0 0 24 24" className="h-full w-full text-emerald-600" aria-hidden>
                <path
                  fill="currentColor"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4zM8 18v-2h2v2H8zm0-4v-2h2v2H8zm0-4V8h2v2H8zm4 8v-2h2v2h-2zm0-4v-2h2v2h-2zm0-4V8h2v2h-2zm4 8v-2h2v2h-2zm0-4v-2h2v2h-2zm0-4V8h2v2h-2z"
                />
              </svg>
            </InputSourceCard>
            <InputSourceCard label="电子书" tagClass="border-t-amber-600">
              <svg viewBox="0 0 24 24" className="h-full w-full text-amber-600" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4 4h8a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2V4zm10 0h6v16h-6V4zm-8 4h6v2H6V8zm0 4h6v2H6v-2zm0 4h4v2H6v-2z"
                />
              </svg>
            </InputSourceCard>
          </ul>

          {/* 中间：笔记本 + 对话 */}
          <div className="relative mx-auto flex w-full max-w-[min(17.5rem,88vw)] flex-col items-center md:max-w-[min(19rem,100%)]">
            <div
              className="pointer-events-none absolute -top-1 left-1/2 hidden h-10 w-20 -translate-x-1/2 rounded-t-full border border-dashed border-amber-400/40 md:block"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -top-0.5 left-1/2 hidden h-4 w-4 -translate-x-1/2 rounded-full bg-amber-300/90 shadow-[0_0_12px_rgba(251,191,36,0.55)] md:block"
              aria-hidden
            />

            <FlowArrows className="absolute inset-0 -z-10 hidden h-full w-full scale-[1.02] opacity-60 md:block" />

            <div className="w-full rounded-xl border-[3px] border-slate-400/80 bg-gradient-to-b from-slate-200/90 to-slate-300/80 p-1 shadow-md dark:border-slate-600 dark:from-slate-800/90 dark:to-slate-900/80">
              <div className="overflow-hidden rounded-lg border border-line/60 bg-surface shadow-inner">
                <div className="flex items-center gap-1.5 border-b border-line/70 bg-fill/60 px-2 py-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand text-[7px] font-extrabold leading-none text-white shadow-sm">
                    P
                  </span>
                  <span className="min-w-0 truncate text-[10px] font-bold tracking-tight text-ink">PrestoAI</span>
                  <span className="ml-auto flex gap-0.5 text-muted">
                    <span className="block h-3 w-3 rounded-sm border border-line/80" />
                    <span className="block h-3 w-3 rounded-full border border-line/80" />
                  </span>
                </div>
                <div className="space-y-1.5 bg-gradient-to-b from-fill/40 to-surface/95 p-2 sm:space-y-2 sm:p-2.5">
                  <div className="rounded-lg bg-brand/15 px-2 py-1.5 text-[9px] leading-snug text-ink/90 ring-1 ring-brand/10 sm:text-[10px]">
                    你好，我是你的多形态创作助手
                  </div>
                  <div className="rounded-lg border border-line/60 bg-surface/95 px-2 py-1.5 text-[9px] leading-snug text-ink/85 shadow-sm sm:text-[10px]">
                    <span>正在分析你的资料</span>
                    <span className="ml-1 inline-flex gap-0.5 align-middle">
                      <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-brand" style={{ animationDelay: "0ms" }} />
                      <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-brand" style={{ animationDelay: "150ms" }} />
                      <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-brand" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                  <div className="rounded-lg border border-line/60 bg-surface/95 px-2 py-1.5 text-[9px] shadow-sm sm:text-[10px]">
                    <p className="font-semibold text-muted">来源引用</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[1, 2, 3, 4].map((n) => (
                        <span
                          key={n}
                          className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full border border-brand/40 px-1 text-[8px] font-bold text-brand"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mx-auto mt-0.5 h-1.5 w-[55%] rounded-b-md bg-slate-400/75 dark:bg-slate-600" />
            <div className="mx-auto mt-1 h-2 w-[72%] rounded-sm bg-slate-400/55 dark:bg-slate-600/80" />

            <div className="mt-3 flex w-full max-w-[14rem] items-center justify-center gap-0.5 px-1 sm:max-w-[15rem]">
              {[1, 2, 3, 4].map((n, i) => (
                <Fragment key={n}>
                  {i > 0 ? (
                    <span className="mx-0.5 h-px min-w-[6px] flex-1 max-w-[18px] border-t border-dotted border-line/65" />
                  ) : null}
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-line/80 text-[7px] font-semibold text-ink/70">
                    {n}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>

          {/* 右侧：输出形态 */}
          <ul className="mx-auto flex max-w-full flex-row flex-wrap justify-center gap-2.5 md:mx-0 md:flex-col md:items-center md:justify-center md:gap-3 md:py-1">
            <OutputCard label="文章" tagClass="border-t-brand">
              <svg viewBox="0 0 24 24" className="h-full w-full text-brand" aria-hidden>
                <path
                  fill="currentColor"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4zM8 12h8v2H8v-2zm0 4h8v2H8v-2zm0-8h5v2H8V8z"
                />
              </svg>
            </OutputCard>
            <OutputCard label="播客" tagClass="border-t-orange-500">
              <svg viewBox="0 0 24 24" className="h-full w-full text-orange-500" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4 8a8 8 0 0 1 16 0v5a4 4 0 0 1-4 4h-1v-2h1a2 2 0 0 0 2-2V8a6 6 0 0 0-12 0v5H4V8zm6 10v-3H8v3a4 4 0 0 0 8 0v-3h-2v3a2 2 0 0 1-4 0z"
                />
              </svg>
            </OutputCard>
            <OutputCard label="摘要" tagClass="border-t-emerald-600">
              <svg viewBox="0 0 24 24" className="h-full w-full text-emerald-600" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4 6h16v2H4V6zm0 4h10v2H4v-2zm0 4h14v2H4v-2zm0 4h8v2H4v-2z"
                />
              </svg>
            </OutputCard>
          </ul>
        </div>

        <p className="mt-4 text-center text-[9px] leading-snug text-muted sm:text-[10px]">基于可信资料，减少 AI 幻觉</p>
      </div>
    </div>
  );
}
