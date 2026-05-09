"use client";

import type { MaterialTimelineSlice } from "../../lib/clipVirtualTimeline";

type Props = {
  slices: readonly MaterialTimelineSlice[];
  totalMs: number;
  currentTimeMs: number;
  onSeekMs?: (ms: number) => void;
  className?: string;
};

/**
 * 按素材顺序与时长比例展示总进度上的分段色块，并叠加当前播放位置。
 */
export default function ClipMaterialTimelineScrubber({
  slices,
  totalMs,
  currentTimeMs,
  onSeekMs,
  className
}: Props) {
  const cap = Math.max(1, totalMs);
  const t = Math.max(0, Math.min(cap, currentTimeMs));
  const pct = (t / cap) * 100;
  const interactive = typeof onSeekMs === "function";

  return (
    <div
      className={[
        "relative h-2 w-full overflow-hidden rounded-full bg-track/80 ring-1 ring-line/60",
        interactive ? "cursor-pointer" : "",
        className ?? ""
      ].join(" ")}
      role={interactive ? "slider" : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? Math.round(cap) : undefined}
      aria-valuenow={interactive ? Math.round(t) : undefined}
      onClick={
        interactive
          ? (e) => {
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              const ratio = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
              onSeekMs!(Math.round(Math.max(0, Math.min(1, ratio)) * cap));
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              const step = Math.max(3000, Math.round(cap / 80));
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                onSeekMs!(Math.max(0, t - step));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                onSeekMs!(Math.min(cap, t + step));
              }
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="absolute inset-0 flex">
        {slices.map((sl, i) => {
          const w = (sl.durationMs / cap) * 100;
          const hue = (i * 47) % 360;
          return (
            <div
              key={`mt-${i}-${sl.startMs}`}
              className="h-full shrink-0 border-r border-line/40 last:border-r-0"
              style={{
                width: `${w}%`,
                background: `hsla(${hue}, 35%, 42%, 0.38)`
              }}
              title={`素材段 ${i + 1}`}
            />
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute bottom-0 top-0 w-px bg-brand shadow-[0_0_0_1px_rgba(255,255,255,0.35)]"
        style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
      />
    </div>
  );
}
