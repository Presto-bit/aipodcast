"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo } from "react";
import type { ClipTimelineClip, ClipTimelineDoc } from "../../lib/clipTypes";

type Props = {
  timeline: ClipTimelineDoc | null;
  durationMs: number | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSeekToClip: (clip: ClipTimelineClip) => void;
  title: string;
  intro: string;
  empty: string;
  clipsLabel: string;
};

export default function ClipTimelineStrip({
  timeline,
  durationMs,
  collapsed,
  onToggleCollapsed,
  onSeekToClip,
  title,
  intro,
  empty,
  clipsLabel
}: Props) {
  const speechClips = useMemo(() => {
    const tr = timeline?.tracks?.find((x) => x.kind === "speech" || x.id === "speech");
    return Array.isArray(tr?.clips) ? tr!.clips! : [];
  }, [timeline]);

  const totalMs = useMemo(() => {
    if (durationMs != null && durationMs > 0) return durationMs;
    if (!speechClips.length) return 0;
    return Math.max(...speechClips.map((c) => Number(c.end_ms) || 0), 0);
  }, [durationMs, speechClips]);

  return (
    <div className="mb-2 rounded-xl border border-line bg-fill/25">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={onToggleCollapsed}
      >
        <span className="text-[11px] font-semibold text-ink">{title}</span>
        {collapsed ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" /> : <ChevronUp className="h-4 w-4 shrink-0 text-muted" />}
      </button>
      {!collapsed ? (
        <div className="border-t border-line/60 px-3 pb-3 pt-1">
          <p className="mb-2 text-[10px] leading-relaxed text-muted">{intro}</p>
          {totalMs <= 0 || !speechClips.length ? (
            <p className="text-[11px] text-muted">{empty}</p>
          ) : (
            <>
              <div className="flex h-7 w-full overflow-hidden rounded-md bg-canvas ring-1 ring-line">
                {speechClips.map((c) => {
                  const wPct = Math.max(0.35, ((c.end_ms - c.start_ms) / totalMs) * 100);
                  return (
                    <button
                      key={c.id || `${c.start_ms}-${c.end_ms}`}
                      type="button"
                      title={`${c.start_ms}–${c.end_ms} ms`}
                      className="h-full border-r border-canvas/80 bg-brand/30 hover:bg-brand/45"
                      style={{ width: `${wPct}%` }}
                      onClick={() => onSeekToClip(c)}
                    />
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-muted">
                {speechClips.length} {clipsLabel}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
