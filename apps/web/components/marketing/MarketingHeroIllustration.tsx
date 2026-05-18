import { useId, type ReactNode } from "react";

/**
 * 营销首屏装饰：无远程大图。叙事为「多源资料 → PrestoAI 分析对话 → 多形态输出」。
 * 外框尺寸与改版前一致：max-w 460px、aspect 5/4（sm 4/3）。
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
    <li className="relative flex aspect-square w-[2.65rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-line/70 bg-surface/95 px-0.5 py-1 shadow-sm sm:w-[2.85rem]">
      <span
        className={`pointer-events-none absolute right-0 top-0 h-0 w-0 rounded-tr-md border-l-[8px] border-l-transparent border-t-[8px] border-t-transparent ${tagClass}`}
        aria-hidden
      />
      <span className="flex h-5 w-5 items-center justify-center sm:h-[1.35rem] sm:w-[1.35rem]">{children}</span>
      <span className="text-center text-[7px] font-semibold leading-none text-ink/90">{label}</span>
    </li>
  );
}

/** 资料卡 → 笔记本 → 输出卡：每条路径独立弧线 + 箭头，对齐参考图流向 */
function FlowArrows({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const markerId = `hero-flow-arrow-${uid}`;

  const inputPaths = [
    "M 25 10 C 31 10, 35 40, 37 46",
    "M 25 26 C 31 26, 35 44, 37 48",
    "M 25 42 C 31 42, 35 48, 37 50",
    "M 25 58 C 31 58, 35 52, 37 52",
    "M 25 74 C 31 74, 35 54, 37 54"
  ];

  const outputPaths = [
    "M 63 46 C 67 36, 72 24, 76 24",
    "M 63 50 C 69 50, 72 50, 76 50",
    "M 63 54 C 67 64, 72 76, 76 76"
  ];

  const strokeProps = {
    stroke: "currentColor",
    strokeWidth: 1,
    strokeLinecap: "round" as const,
    fill: "none",
    vectorEffect: "non-scaling-stroke" as const,
    markerEnd: `url(#${markerId})`
  };

  return (
    <svg
      className={`pointer-events-none text-line/60 ${className}`}
      viewBox="0 0 100 88"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="5"
          markerHeight="5"
          refX="4"
          refY="2.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L5,2.5 L0,5 Z" fill="currentColor" fillOpacity="0.7" />
        </marker>
      </defs>

      {/* 笔记本内部：分析 → 输出 */}
      <path
        d="M 37 50 L 63 50"
        stroke="currentColor"
        strokeWidth="0.85"
        strokeLinecap="round"
        strokeDasharray="2.5 2"
        opacity="0.35"
        vectorEffect="non-scaling-stroke"
      />

      {inputPaths.map((d, i) => (
        <path key={`in-${i}`} d={d} {...strokeProps} opacity={0.72} />
      ))}
      {outputPaths.map((d, i) => (
        <path key={`out-${i}`} d={d} {...strokeProps} opacity={0.72} />
      ))}
    </svg>
  );
}

function LaptopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-full flex-col items-center">
      {/* 屏幕盖：银灰边框 + 摄像头 */}
      <div className="w-full rounded-t-[0.55rem] border-2 border-b-0 border-slate-400/90 bg-gradient-to-b from-slate-300 via-slate-300 to-slate-400/95 p-[3px] pb-1 shadow-[0_6px_14px_-6px_rgba(15,23,42,0.35)] dark:border-slate-500 dark:from-slate-700 dark:via-slate-700 dark:to-slate-800">
        <div className="flex h-1.5 shrink-0 items-center justify-center rounded-t-[0.2rem] bg-slate-400/55 dark:bg-slate-600/80">
          <span className="h-[3px] w-[3px] rounded-full bg-slate-600/70 ring-1 ring-slate-500/30 dark:bg-slate-400/60" />
        </div>
        <div className="overflow-hidden rounded-[0.2rem] border border-slate-500/25 bg-surface shadow-inner dark:border-slate-600/40">
          {children}
        </div>
      </div>

      {/* 转轴 */}
      <div className="z-[1] -mt-px h-[2px] w-[84%] rounded-full bg-gradient-to-r from-transparent via-slate-500/70 to-transparent" />

      {/* 键盘底座：略宽于屏幕 */}
      <div className="relative z-0 -mt-px w-[106%] max-w-[calc(100%+0.35rem)] rounded-b-[0.65rem] border-2 border-t border-slate-400/90 bg-gradient-to-b from-slate-300/98 to-slate-400/90 px-1.5 pb-1 pt-1 shadow-[0_8px_16px_-8px_rgba(15,23,42,0.4)] dark:border-slate-500 dark:from-slate-700 dark:to-slate-800">
        <div className="mx-auto grid h-[5px] max-w-[94%] grid-cols-10 gap-px rounded-[2px] bg-slate-500/12 p-px dark:bg-slate-900/25">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="rounded-[1px] bg-slate-500/28 dark:bg-slate-400/15" />
          ))}
        </div>
        <div className="mx-auto mt-0.5 h-[3px] w-[26%] rounded-[2px] bg-slate-500/18 dark:bg-slate-400/12" />
      </div>
    </div>
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
    <li className="relative flex aspect-square w-[2.85rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-line/70 bg-surface/95 px-0.5 py-1 shadow-sm sm:w-[3rem]">
      <span
        className={`pointer-events-none absolute right-0 top-0 h-0 w-0 rounded-tr-md border-l-[8px] border-l-transparent border-t-[8px] border-t-transparent ${tagClass}`}
        aria-hidden
      />
      <span className="flex h-[1.35rem] w-[1.35rem] items-center justify-center sm:h-6 sm:w-6">{children}</span>
      <span className="text-center text-[7px] font-semibold leading-none text-ink/90">{label}</span>
    </li>
  );
}

export default function MarketingHeroIllustration() {
  return (
    <div
      className="relative flex aspect-[5/4] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-line/90 bg-surface/95 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)] sm:aspect-[4/3]"
      aria-hidden
    >
      <div className="relative flex min-h-0 flex-1 flex-col px-2 pb-2 pt-2 sm:px-2.5 sm:pb-2.5 sm:pt-2.5">
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,0.82fr)_minmax(0,1.35fr)_minmax(0,0.82fr)] items-center gap-1 sm:gap-1.5">
          <FlowArrows className="absolute inset-[2%_0] z-0 h-[96%] w-full" />
          {/* 左侧：资料源 */}
          <ul className="relative z-[1] flex flex-col items-center justify-center gap-1">
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

          {/* 中间：笔记本电脑 + PrestoAI 屏幕 */}
          <div className="relative z-[1] flex min-h-0 w-full flex-col items-center justify-center">
            <LaptopFrame>
                <div className="flex items-center gap-1 border-b border-line/70 bg-fill/60 px-1.5 py-0.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-brand text-[6px] font-extrabold leading-none text-white">
                    P
                  </span>
                  <span className="min-w-0 truncate text-[8px] font-bold tracking-tight text-ink">PrestoAI</span>
                </div>
                <div className="space-y-1 bg-gradient-to-b from-fill/40 to-surface/95 p-1.5">
                  <div className="rounded-md bg-brand/15 px-1.5 py-1 text-[7px] leading-snug text-ink/90 ring-1 ring-brand/10 sm:text-[8px]">
                    你好，我是你的多形态创作助手
                  </div>
                  <div className="rounded-md border border-line/60 bg-surface/95 px-1.5 py-1 text-[7px] leading-snug text-ink/85 sm:text-[8px]">
                    <span>正在分析你的资料</span>
                    <span className="ml-0.5 inline-flex gap-px align-middle">
                      <span className="inline-block h-0.5 w-0.5 animate-pulse rounded-full bg-brand" />
                      <span className="inline-block h-0.5 w-0.5 animate-pulse rounded-full bg-brand [animation-delay:150ms]" />
                      <span className="inline-block h-0.5 w-0.5 animate-pulse rounded-full bg-brand [animation-delay:300ms]" />
                    </span>
                  </div>
                  <div className="rounded-md border border-line/60 bg-surface/95 px-1.5 py-1 text-[7px] sm:text-[8px]">
                    <p className="font-semibold text-muted">来源引用</p>
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {[1, 2, 3, 4].map((n) => (
                        <span
                          key={n}
                          className="inline-flex h-3 min-w-[0.75rem] items-center justify-center rounded-full border border-brand/40 px-0.5 text-[7px] font-bold text-brand"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
            </LaptopFrame>
          </div>

          {/* 右侧：输出形态 */}
          <ul className="relative z-[1] flex flex-col items-center justify-center gap-1.5">
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

        <p className="mt-1 shrink-0 text-center text-[8px] leading-snug text-muted">基于可信资料，减少 AI 幻觉</p>
      </div>
    </div>
  );
}
