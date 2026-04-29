"use client";

import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ClipWaveformHandle } from "../clip/ClipWaveformPanel";

type Props = {
  waveformRef: RefObject<ClipWaveformHandle | null>;
  /** 以当前焦点词为中心，试听前后各 5 秒（含原片，不跳过剪掉段） */
  clipPreviewAroundLabel?: string;
  onClipPreviewAround?: () => void;
  clipPreviewAroundDisabled?: boolean;
  /** 快捷键说明（如「空格：播放/暂停」） */
  keyboardHint?: string;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** 倍速选项标签，顺序须与 rates 一致 */
  rateOptionLabels?: readonly string[];
  magneticSnap?: boolean;
  onMagneticSnapChange?: (v: boolean) => void;
  magneticSnapLabel?: string;
  /** 嵌入「音频区域」分栏：弱化顶边与底板，与上方转写区连成一体 */
  dockEmbed?: boolean;
  /** 倍速下拉 aria 标签 */
  rateSelectAriaLabel?: string;
  durationMs?: number;
  currentTimeMs?: number;
  onSeekMs?: (ms: number) => void;
};

const DEFAULT_RATES = [1, 1.25, 1.5, 2] as const;

function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function AudioConsole({
  waveformRef,
  clipPreviewAroundLabel,
  onClipPreviewAround,
  clipPreviewAroundDisabled,
  keyboardHint,
  playbackRate = 1,
  onPlaybackRateChange,
  rateOptionLabels,
  magneticSnap = false,
  onMagneticSnapChange,
  magneticSnapLabel = "磁吸",
  dockEmbed = false,
  rateSelectAriaLabel = "播放倍速",
  durationMs = 0,
  currentTimeMs = 0,
  onSeekMs
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const rateWrapRef = useRef<HTMLDivElement | null>(null);
  const volumeWrapRef = useRef<HTMLDivElement | null>(null);
  const rateBtnRef = useRef<HTMLButtonElement | null>(null);
  const rateMenuRef = useRef<HTMLUListElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateMenuPos = useCallback(() => {
    const el = rateBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(5.5 * 16, r.width);
    setMenuPos({ top: r.bottom + 4, left: r.right - width, width });
  }, []);

  useLayoutEffect(() => {
    if (!rateMenuOpen || !onPlaybackRateChange) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const ro = () => updateMenuPos();
    window.addEventListener("resize", ro);
    window.addEventListener("scroll", ro, true);
    return () => {
      window.removeEventListener("resize", ro);
      window.removeEventListener("scroll", ro, true);
    };
  }, [rateMenuOpen, onPlaybackRateChange, updateMenuPos]);

  useEffect(() => {
    if (!rateMenuOpen) return;
    const close = (e: MouseEvent) => {
      const wrap = rateWrapRef.current;
      const menu = rateMenuRef.current;
      const t = e.target;
      if (t instanceof Node) {
        if (wrap?.contains(t)) return;
        if (menu?.contains(t)) return;
      }
      setRateMenuOpen(false);
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [rateMenuOpen]);

  useEffect(() => {
    if (!volumeOpen) return;
    const close = (e: MouseEvent) => {
      const wrap = volumeWrapRef.current;
      const t = e.target;
      if (t instanceof Node && wrap?.contains(t)) return;
      setVolumeOpen(false);
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [volumeOpen]);

  const togglePlay = useCallback(() => {
    waveformRef.current?.playPause();
  }, [waveformRef]);

  const rates = DEFAULT_RATES;
  const labels = rateOptionLabels?.length === rates.length ? rateOptionLabels : null;
  const currentLabel = labels
    ? labels[rates.indexOf(playbackRate as (typeof rates)[number])] ?? `${playbackRate}×`
    : `${playbackRate}×`;
  const boundedCurrentMs = Math.max(0, Math.min(durationMs || 0, currentTimeMs || 0));
  const ratePortal =
    rateMenuOpen && onPlaybackRateChange && menuPos && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={rateMenuRef}
            role="listbox"
            className="fixed z-[10050] min-w-[5.5rem] rounded-lg border border-line bg-surface py-1 shadow-xl"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {rates.map((r, i) => (
              <li key={r} role="option" aria-selected={playbackRate === r}>
                <button
                  type="button"
                  className={[
                    "w-full px-3 py-1.5 text-left text-[10px] font-semibold transition",
                    playbackRate === r ? "bg-brand/15 text-brand" : "text-ink hover:bg-fill"
                  ].join(" ")}
                  onClick={() => {
                    onPlaybackRateChange(r);
                    setRateMenuOpen(false);
                  }}
                >
                  {labels ? labels[i] : `${r}×`}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )
      : null;

  return (
    <div
      className={[
        "shrink-0 px-3 pb-1.5 pt-1 sm:px-4",
        dockEmbed
          ? "border-t-0 bg-fill/40 backdrop-blur-sm"
          : "border-t border-line bg-fill/60 backdrop-blur-sm"
      ].join(" ")}
    >
      {ratePortal}
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1">
        {keyboardHint ? (
          <p className="text-center text-[10px] text-muted sm:text-left">{keyboardHint}</p>
        ) : null}
        <div className="flex items-center gap-2 px-1">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-surface shadow-soft hover:opacity-95"
            onClick={togglePlay}
          >
            {playing ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="h-5 w-5 pl-0.5" aria-hidden />}
          </button>
          {onPlaybackRateChange ? (
            <div ref={rateWrapRef} className="relative shrink-0">
              <button
                ref={rateBtnRef}
                type="button"
                aria-label={rateSelectAriaLabel}
                aria-expanded={rateMenuOpen}
                aria-haspopup="listbox"
                className="inline-flex h-7 min-w-[3rem] items-center justify-center rounded-md px-1.5 text-sm font-semibold text-ink hover:bg-fill"
                onClick={(e) => {
                  e.stopPropagation();
                  setRateMenuOpen((o) => !o);
                }}
              >
                <span>{currentLabel.replace("×", "x")}</span>
              </button>
            </div>
          ) : null}
          <div ref={volumeWrapRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="音量"
              aria-expanded={volumeOpen}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink hover:bg-fill"
              onClick={(e) => {
                e.stopPropagation();
                setVolumeOpen((v) => !v);
              }}
            >
              <Volume2 className="h-4 w-4" aria-hidden />
            </button>
            {volumeOpen ? (
              <div className="absolute left-0 top-[calc(100%+6px)] z-[10020] w-28 rounded-md border border-line bg-surface p-2 shadow-xl">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(volume * 100)}
                  className="h-1.5 w-full cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                  onChange={(e) => {
                    const next = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
                    setVolume(next);
                    waveformRef.current?.setVolume(next);
                  }}
                />
                <p className="mt-1 text-center text-[10px] tabular-nums text-muted">{Math.round(volume * 100)}%</p>
              </div>
            ) : null}
          </div>
          {durationMs > 0 ? (
            <div className="mx-1 flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-sm tabular-nums text-muted">{formatClock(boundedCurrentMs)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                value={Math.max(0, Math.min(durationMs, currentTimeMs))}
                className="h-1.5 w-full min-w-0 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                onChange={(e) => onSeekMs?.(Number(e.target.value) || 0)}
              />
              <span className="shrink-0 text-sm tabular-nums text-muted">{formatClock(durationMs || 0)}</span>
            </div>
          ) : (
            <div className="mx-1 flex-1" />
          )}
        </div>
        <div className="hidden flex-wrap items-center justify-center gap-2 px-1 sm:justify-start">
          {onMagneticSnapChange && magneticSnapLabel ? (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted"
              htmlFor="presto-audio-console-magnetic-snap"
            >
              <input
                id="presto-audio-console-magnetic-snap"
                name="presto_audio_magnetic_snap"
                type="checkbox"
                className="rounded border-line"
                checked={magneticSnap}
                onChange={(e) => onMagneticSnapChange(e.target.checked)}
              />
              <span>{magneticSnapLabel}</span>
            </label>
          ) : null}
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
