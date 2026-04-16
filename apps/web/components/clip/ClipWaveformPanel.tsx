"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

export type ClipWaveformHandle = {
  seekToMs: (ms: number) => void;
  playPause: () => void;
  pause: () => void;
  play: () => Promise<void>;
  /** 最近一次 timeupdate 的毫秒（无解码时可能为 0） */
  getCurrentTimeMs: () => number;
};

type Props = {
  audioUrl: string | null | undefined;
  /** 毫秒，播放进度（与词级 s_ms/e_ms 对齐） */
  onTimeMs: (ms: number) => void;
  onLoadError?: (message: string) => void;
  /** panel：卡片内嵌；dock：底部时间轴条（深色底，类似 FlexClip 时间轴区） */
  variant?: "panel" | "dock";
  /** 波形像素高度；dock 默认 112，可改为 40 做「能量条」 */
  waveHeight?: number;
  className?: string;
  onPlayStateChange?: (playing: boolean) => void;
};

const ClipWaveformPanel = forwardRef<ClipWaveformHandle, Props>(function ClipWaveformPanel(
  { audioUrl, onTimeMs, onLoadError, variant = "panel", waveHeight, className, onPlayStateChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const lastTimeMsRef = useRef(0);
  const onTimeRef = useRef(onTimeMs);
  const onPlayRef = useRef(onPlayStateChange);
  onTimeRef.current = onTimeMs;
  onPlayRef.current = onPlayStateChange;

  useImperativeHandle(ref, () => ({
    seekToMs: (ms: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const sec = Math.max(0, ms / 1000);
      ws.setTime(sec);
    },
    playPause: () => {
      const ws = wsRef.current;
      if (!ws) return;
      void ws.playPause();
    },
    pause: () => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.pause();
    },
    play: () => {
      const ws = wsRef.current;
      if (!ws) return Promise.resolve();
      return ws.play();
    },
    getCurrentTimeMs: () => lastTimeMsRef.current
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!audioUrl?.trim() || !el) {
      return undefined;
    }
    el.innerHTML = "";
    const dock = variant === "dock";
    const h = typeof waveHeight === "number" && waveHeight > 16 ? waveHeight : dock ? 112 : 96;
    const ws = WaveSurfer.create({
      container: el,
      url: audioUrl,
      height: h,
      waveColor: dock ? "rgba(100, 116, 139, 0.28)" : "rgba(100, 100, 115, 0.35)",
      progressColor: dock ? "rgba(99, 102, 241, 0.55)" : "rgba(59, 130, 246, 0.5)",
      cursorColor: dock ? "rgb(99, 102, 241)" : "rgb(99, 102, 241)",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      mediaControls: true,
      dragToSeek: true,
      minPxPerSec: 40,
      /** 同源代理音频须携带 HttpOnly 会话 Cookie，否则 BFF 无法转发 Authorization */
      fetchParams: { mode: "same-origin", credentials: "include" }
    });
    wsRef.current = ws;
    const unsubTime = ws.on("timeupdate", (t) => {
      const ms = t * 1000;
      lastTimeMsRef.current = ms;
      onTimeRef.current(ms);
    });
    const unsubPlay = ws.on("play", () => onPlayRef.current?.(true));
    const unsubPause = ws.on("pause", () => onPlayRef.current?.(false));
    const unsubErr = ws.on("error", (err) => {
      onLoadError?.(String(err?.message || err || "waveform_error"));
    });
    return () => {
      unsubTime();
      unsubPlay();
      unsubPause();
      unsubErr();
      try {
        ws.destroy();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [audioUrl, onLoadError, variant, waveHeight, onPlayStateChange]);

  if (!audioUrl?.trim()) {
    return null;
  }

  const shell =
    variant === "dock"
      ? "w-full overflow-hidden rounded-md border border-line bg-track/50 shadow-inset-brand"
      : "w-full overflow-hidden rounded-lg border border-line bg-track/40";

  return <div ref={containerRef} className={[shell, className || ""].filter(Boolean).join(" ")} />;
});

export default ClipWaveformPanel;
