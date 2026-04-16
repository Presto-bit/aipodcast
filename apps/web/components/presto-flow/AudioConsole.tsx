"use client";

import type { RefObject } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useState } from "react";
import ClipWaveformPanel, { type ClipWaveformHandle } from "../clip/ClipWaveformPanel";

type Props = {
  audioUrl: string | undefined;
  onTimeMs: (ms: number) => void;
  onLoadError?: (msg: string) => void;
  waveformRef: RefObject<ClipWaveformHandle | null>;
  /** 以当前焦点词为中心，试听前后各 5 秒（含原片，不跳过剪掉段） */
  clipPreviewAroundLabel?: string;
  onClipPreviewAround?: () => void;
  clipPreviewAroundDisabled?: boolean;
};

export default function AudioConsole({
  audioUrl,
  onTimeMs,
  onLoadError,
  waveformRef,
  clipPreviewAroundLabel,
  onClipPreviewAround,
  clipPreviewAroundDisabled
}: Props) {
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback(() => {
    waveformRef.current?.playPause();
  }, [waveformRef]);

  const skip = useCallback(
    (sec: number) => {
      const ws = waveformRef.current;
      if (!ws) return;
      const cur = ws.getCurrentTimeMs();
      ws.seekToMs(Math.max(0, cur + sec * 1000));
    },
    [waveformRef]
  );

  return (
    <div className="shrink-0 border-t border-line bg-fill/60 px-3 py-3 backdrop-blur-sm sm:px-4">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2">
        <div className="h-10 overflow-hidden rounded-lg border border-line bg-track/50">
          {audioUrl ? (
            <ClipWaveformPanel
              ref={waveformRef as RefObject<ClipWaveformHandle>}
              variant="dock"
              waveHeight={40}
              audioUrl={audioUrl}
              onTimeMs={onTimeMs}
              onLoadError={onLoadError}
              onPlayStateChange={setPlaying}
              className="!border-0 !bg-transparent"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-muted">—</div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          <button
            type="button"
            aria-label="Back 5s"
            className="rounded-full border border-line bg-surface p-2 text-ink shadow-soft hover:bg-fill"
            onClick={() => skip(-5)}
          >
            <SkipBack className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="rounded-full border border-line bg-brand p-3 text-brand-foreground shadow-soft hover:opacity-95"
            onClick={togglePlay}
          >
            {playing ? <Pause className="h-6 w-6" aria-hidden /> : <Play className="h-6 w-6 pl-0.5" aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="Forward 5s"
            className="rounded-full border border-line bg-surface p-2 text-ink shadow-soft hover:bg-fill"
            onClick={() => skip(5)}
          >
            <SkipForward className="h-5 w-5" aria-hidden />
          </button>
          {clipPreviewAroundLabel && onClipPreviewAround ? (
            <button
              type="button"
              disabled={clipPreviewAroundDisabled}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink shadow-soft hover:bg-fill disabled:pointer-events-none disabled:opacity-45"
              onClick={() => onClipPreviewAround()}
            >
              {clipPreviewAroundLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
