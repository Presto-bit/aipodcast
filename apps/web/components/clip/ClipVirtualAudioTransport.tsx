"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ClipWaveformHandle } from "./ClipWaveformPanel";
import type { VirtualAudioCue } from "../../lib/clipVirtualTimeline";
import { totalVirtualDurationMs } from "../../lib/clipVirtualTimeline";

type Props = {
  cues: readonly VirtualAudioCue[];
  onTimeMs: (ms: number) => void;
  onLoadError?: (message: string) => void;
  playbackRate?: number;
  snapSeekMs?: (ms: number) => number;
  className?: string;
};

function findCueIndex(cues: readonly VirtualAudioCue[], globalMs: number): number {
  if (!cues.length) return 0;
  const t = Math.max(0, globalMs);
  for (let i = cues.length - 1; i >= 0; i--) {
    if (t + 1 >= cues[i]!.startGlobalMs) return i;
  }
  return 0;
}

const ClipVirtualAudioTransport = forwardRef<ClipWaveformHandle, Props>(function ClipVirtualAudioTransport(
  { cues, onTimeMs, onLoadError, playbackRate = 1, snapSeekMs, className },
  ref
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cueIdxRef = useRef(0);
  const [displayMs, setDisplayMs] = useState(0);
  const displayMsRef = useRef(0);
  const totalMs = totalVirtualDurationMs(cues);

  useEffect(() => {
    displayMsRef.current = displayMs;
  }, [displayMs]);

  const emitGlobal = useCallback(
    (globalRounded: number) => {
      const g = Math.max(0, Math.min(totalMs || 0, globalRounded));
      setDisplayMs(g);
      onTimeMs(g);
    },
    [onTimeMs, totalMs]
  );

  const mountCueAtGlobal = useCallback(
    (globalMs: number, opts?: { play?: boolean }) => {
      const t = Math.max(0, Math.min(totalMs || 0, Math.round(globalMs)));
      const idx = findCueIndex(cues, t);
      const cue = cues[idx];
      const el = audioRef.current;
      if (!cue || !el) {
        emitGlobal(t);
        return;
      }
      const localMs = Math.max(0, Math.min(cue.durationMs - 40, t - cue.startGlobalMs));
      cueIdxRef.current = idx;
      if (el.src !== cue.url) el.src = cue.url;
      el.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
      el.currentTime = localMs / 1000;
      emitGlobal(t);
      if (opts?.play) {
        void el.play().catch(() => onLoadError?.("无法播放当前分段"));
      }
    },
    [cues, emitGlobal, onLoadError, playbackRate, totalMs]
  );

  useImperativeHandle(ref, () => ({
    seekToMs: (ms: number) => {
      const snapped = typeof snapSeekMs === "function" ? snapSeekMs(ms) : ms;
      const el = audioRef.current;
      el?.pause();
      mountCueAtGlobal(snapped, { play: false });
    },
    playPause: () => {
      const el = audioRef.current;
      if (!el || !cues.length) return;
      if (!el.paused) {
        el.pause();
        return;
      }
      mountCueAtGlobal(displayMsRef.current, { play: true });
    },
    pause: () => audioRef.current?.pause(),
    play: async () => {
      const el = audioRef.current;
      if (!el || !cues.length) return;
      mountCueAtGlobal(displayMsRef.current, { play: true });
      try {
        await el.play();
      } catch {
        onLoadError?.("无法播放音频");
      }
    },
    getCurrentTimeMs: () => displayMs,
    setPlaybackRate: (rate: number) => {
      const el = audioRef.current;
      if (!el) return;
      el.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    },
    setZoom: () => {},
    setVolume: (volume: number) => {
      const el = audioRef.current;
      if (!el) return;
      el.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    }
  }));

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onTime = () => {
      const cue = cues[cueIdxRef.current];
      if (!cue) return;
      const g = Math.round(cue.startGlobalMs + el.currentTime * 1000);
      emitGlobal(g);
    };
    const onEnded = () => {
      const next = cueIdxRef.current + 1;
      if (next >= cues.length) {
        el.pause();
        return;
      }
      cueIdxRef.current = next;
      const nc = cues[next]!;
      el.src = nc.url;
      el.currentTime = 0;
      emitGlobal(nc.startGlobalMs);
      void el.play().catch(() => onLoadError?.("无法播放下一段"));
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [cues, emitGlobal, onLoadError]);

  if (!cues.length) return null;

  const mm = Math.floor(displayMs / 60000)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor((displayMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");

  return (
    <div className={["flex h-[69px] flex-col justify-center gap-1 rounded-lg border border-line bg-track/40 px-2", className || ""].join(" ")}>
      <p className="text-[10px] text-muted">多段无主轨：按顺序播放各段；时间轴与稿面全局时间对齐。</p>
      <audio ref={audioRef} className="hidden" preload="auto" />
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[10px] text-muted">
          {mm}:{ss}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={Math.max(1, totalMs)}
          value={Math.min(totalMs, displayMs)}
          onChange={(e) => {
            const v = Number(e.target.value);
            audioRef.current?.pause();
            mountCueAtGlobal(v, { play: false });
          }}
        />
      </div>
    </div>
  );
});

export default ClipVirtualAudioTransport;
