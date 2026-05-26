"use client";

type Props = {
  percent: number;
  whoDone: boolean;
  audienceDone: boolean;
  oneLinerDone: boolean;
};

export default function IdentityRing({ percent, whoDone, audienceDone, oneLinerDone }: Props) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg width={96} height={96} className="-rotate-90" aria-hidden>
          <circle cx={48} cy={48} r={r} fill="none" stroke="currentColor" strokeWidth={6} className="text-line/50" />
          <circle
            cx={48}
            cy={48}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={6}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="text-brand transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink">{percent}%</span>
      </div>
      <div className="flex gap-2 text-[10px] text-muted" aria-label="三问进度">
        <span title="一句话" className={oneLinerDone ? "text-brand" : ""}>
          ●
        </span>
        <span title="我是谁" className={whoDone ? "text-brand" : ""}>
          ●
        </span>
        <span title="写给谁" className={audienceDone ? "text-brand" : ""}>
          ●
        </span>
      </div>
    </div>
  );
}
