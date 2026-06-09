"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ClipAudioHandle } from "./clipAudioHandle";
import { safePlayAudioElement } from "./clipAudioSafePlay";

type Props = {
  audioUrl: string | null | undefined;
  onTimeMs: (ms: number) => void;
  onLoadError?: (message: string) => void;
  onPlayStateChange?: (playing: boolean) => void;
  playbackRate?: number;
  className?: string;
};

/** 无 UI 纯 audio 元素，供 AudioConsole 驱动播放/seek；无 URL 时仍挂载元素以保持 ref 可用。 */
const ClipAudioTransport = forwardRef<ClipAudioHandle, Props>(function ClipAudioTransport(
  { audioUrl, onTimeMs, onLoadError, onPlayStateChange, playbackRate = 1, className },
  ref
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTimeMsRef = useRef(0);
  const playTokenRef = useRef(0);
  const onTimeRef = useRef(onTimeMs);
  const onPlayRef = useRef(onPlayStateChange);
  const onErrRef = useRef(onLoadError);
  onTimeRef.current = onTimeMs;
  onPlayRef.current = onPlayStateChange;
  onErrRef.current = onLoadError;

  useImperativeHandle(ref, () => ({
    seekToMs: (ms: number) => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, ms / 1000);
      lastTimeMsRef.current = Math.round(el.currentTime * 1000);
    },
    playPause: () => {
      const el = audioRef.current;
      if (!el) return;
      if (el.paused) {
        safePlayAudioElement(el, (msg) => onErrRef.current?.(msg), playTokenRef);
      } else {
        playTokenRef.current += 1;
        el.pause();
      }
    },
    pause: () => {
      playTokenRef.current += 1;
      audioRef.current?.pause();
    },
    play: () => {
      const el = audioRef.current;
      if (!el) return Promise.resolve();
      if (!el.src) {
        onErrRef.current?.("音频尚未就绪");
        return Promise.resolve();
      }
      safePlayAudioElement(el, (msg) => onErrRef.current?.(msg), playTokenRef);
      return Promise.resolve();
    },
    getCurrentTimeMs: () => lastTimeMsRef.current,
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
    if (!el) return;
    const url = audioUrl?.trim();
    if (!url) {
      playTokenRef.current += 1;
      el.pause();
      el.removeAttribute("src");
      return;
    }
    playTokenRef.current += 1;
    el.pause();
    el.src = url;
    el.load();
  }, [audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const ms = Math.round(el.currentTime * 1000);
      lastTimeMsRef.current = ms;
      onTimeRef.current(ms);
    };
    const onPlay = () => onPlayRef.current?.(true);
    const onPause = () => onPlayRef.current?.(false);
    const onErr = () => onErrRef.current?.("无法播放音频");
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onErr);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onErr);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  }, [playbackRate]);

  return <audio ref={audioRef} className={className ?? "sr-only"} preload="auto" />;
});

export default ClipAudioTransport;
