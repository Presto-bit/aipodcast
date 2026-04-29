"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type ClipWaveformHandle = {
  seekToMs: (ms: number) => void;
  playPause: () => void;
  pause: () => void;
  play: () => Promise<void>;
  /** 最近一次 timeupdate 的毫秒（无解码时可能为 0） */
  getCurrentTimeMs: () => number;
  /** 变速审听；preservePitch 由 wavesurfer 在支持的浏览器中处理 */
  setPlaybackRate: (rate: number) => void;
  /** 1~10，对应波形可视缩放 */
  setZoom: (level: number) => void;
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
  /** 初始播放倍率（1 / 1.25 / 1.5） */
  playbackRate?: number;
  /** 波形点击/拖拽 seek 后回调毫秒，返回磁吸后的毫秒；未传则不磁吸 */
  snapSeekMs?: (ms: number) => number;
  /** false：仅展示波形，不可拖拽 seek / 原生控件（用于多轨示意轨） */
  interactive?: boolean;
  /** false：不向父组件上报 timeupdate（避免多实例抢进度） */
  emitTimeUpdates?: boolean;
  /** 1~10，默认 1 */
  zoomLevel?: number;
};

type WS = Awaited<ReturnType<Awaited<typeof import("wavesurfer.js")>["default"]["create"]>>;

const ClipWaveformPanel = forwardRef<ClipWaveformHandle, Props>(function ClipWaveformPanel(
  {
    audioUrl,
    onTimeMs,
    onLoadError,
    variant = "panel",
    waveHeight,
    className,
    onPlayStateChange,
    playbackRate = 1,
    snapSeekMs,
    interactive = true,
    emitTimeUpdates = true,
    zoomLevel = 1
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WS | null>(null);
  const lastTimeMsRef = useRef(0);
  const onTimeRef = useRef(onTimeMs);
  const onPlayRef = useRef(onPlayStateChange);
  const onLoadErrorRef = useRef(onLoadError);
  const snapSeekRef = useRef(snapSeekMs);
  onTimeRef.current = onTimeMs;
  onPlayRef.current = onPlayStateChange;
  onLoadErrorRef.current = onLoadError;
  snapSeekRef.current = snapSeekMs;

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
    getCurrentTimeMs: () => lastTimeMsRef.current,
    setPlaybackRate: (rate: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
      try {
        ws.setPlaybackRate(r, true);
      } catch {
        ws.setPlaybackRate(r);
      }
    },
    setZoom: (level: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const lv = Math.max(1, Math.min(10, Math.round(level)));
      const pxPerSec = interactive ? 40 * lv : 24;
      try {
        ws.setOptions({ minPxPerSec: pxPerSec });
      } catch {
        // ignore
      }
    }
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!audioUrl?.trim() || !el) {
      return undefined;
    }
    el.innerHTML = "";
    let cancelled = false;
    let unsubInteract: (() => void) | null = null;
    let unsubTime: () => void = () => {};
    let unsubPlay: () => void = () => {};
    let unsubPause: () => void = () => {};
    let unsubErr: () => void = () => {};

    void (async () => {
      const { default: WaveSurfer } = await import("wavesurfer.js");
      if (cancelled || containerRef.current !== el) return;

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
        mediaControls: interactive,
        dragToSeek: interactive,
        minPxPerSec: interactive ? 40 * Math.max(1, Math.min(10, Math.round(zoomLevel))) : 24,
        /** 同源代理音频须携带 HttpOnly 会话 Cookie，否则 BFF 无法转发 Authorization */
        fetchParams: { mode: "same-origin", credentials: "include" }
      });
      if (cancelled || containerRef.current !== el) {
        try {
          ws.destroy();
        } catch {
          // ignore
        }
        return;
      }
      wsRef.current = ws;
      const r0 = 1;
      try {
        ws.setPlaybackRate(r0, true);
      } catch {
        ws.setPlaybackRate(r0);
      }
      unsubInteract =
        interactive && typeof snapSeekRef.current === "function"
          ? ws.on("interaction", (t) => {
              const sec = typeof t === "number" ? t : 0;
              const ms = sec * 1000;
              const snapped = snapSeekRef.current!(ms);
              if (Math.abs(snapped - ms) > 4) {
                ws.setTime(Math.max(0, snapped / 1000));
              }
            })
          : null;
      unsubTime = ws.on("timeupdate", (t) => {
        const sec = typeof t === "number" ? t : 0;
        const ms = Math.round(sec * 1000);
        lastTimeMsRef.current = ms;
        if (emitTimeUpdates) onTimeRef.current(ms);
      });
      unsubPlay = ws.on("play", () => onPlayRef.current?.(true));
      unsubPause = ws.on("pause", () => onPlayRef.current?.(false));
      unsubErr = ws.on("error", (err) => {
        onLoadErrorRef.current?.(String(err?.message || err || "waveform_error"));
      });
    })();

    return () => {
      cancelled = true;
      unsubTime();
      unsubPlay();
      unsubPause();
      unsubErr();
      if (typeof unsubInteract === "function") unsubInteract();
      const w = wsRef.current;
      if (w) {
        try {
          w.destroy();
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
    };
    /* onLoadError / onPlayStateChange 经 ref 读取，避免父组件每次渲染传入新函数引用时反复销毁 WaveSurfer（会导致无法持续播放） */
  }, [audioUrl, variant, waveHeight, interactive, emitTimeUpdates, zoomLevel]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const r = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    try {
      ws.setPlaybackRate(r, true);
    } catch {
      ws.setPlaybackRate(r);
    }
  }, [playbackRate]);

  if (!audioUrl?.trim()) {
    return null;
  }

  const shell =
    variant === "dock"
      ? "w-full overflow-hidden rounded-md border border-line bg-track/50 shadow-inset-brand"
      : "w-full overflow-hidden rounded-lg border border-line bg-track/40";

  return (
    <div
      ref={containerRef}
      className={[
        shell,
        !interactive ? "pointer-events-none select-none opacity-95" : "",
        className || ""
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
});

export default ClipWaveformPanel;
