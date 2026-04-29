"use client";

import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FastForward, Pause, Play, Rewind } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ClipWaveformPanel, { type ClipWaveformHandle } from "../clip/ClipWaveformPanel";

const SKIP_SEC = 5;

type Props = {
  audioUrl: string | undefined;
  onTimeMs: (ms: number) => void;
  onLoadError?: (msg: string) => void;
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
  /** 波形 seek 磁吸；未传则不启用 */
  snapSeekMs?: (ms: number) => number;
  /** 嵌入「音频区域」分栏：弱化顶边与底板，与上方转写区连成一体 */
  dockEmbed?: boolean;
  /** 倍速下拉 aria 标签 */
  rateSelectAriaLabel?: string;
  /** 主轨下方额外示意波形条数（如双声道时 1，与主轨同源、不单独上报进度） */
  mirrorWaveformCount?: number;
  /** 多轨 / 双声道说明文案，显示在波形区上方 */
  multiTrackHint?: string;
  zoomLevel?: number;
  durationMs?: number;
  currentTimeMs?: number;
  onSeekMs?: (ms: number) => void;
};

const DEFAULT_RATES = [1, 1.25, 1.5, 2] as const;

export default function AudioConsole({
  audioUrl,
  onTimeMs,
  onLoadError,
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
  snapSeekMs,
  dockEmbed = false,
  rateSelectAriaLabel = "播放倍速",
  mirrorWaveformCount = 0,
  multiTrackHint,
  zoomLevel = 1,
  durationMs = 0,
  currentTimeMs = 0,
  onSeekMs
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const rateWrapRef = useRef<HTMLDivElement | null>(null);
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

  const rates = DEFAULT_RATES;
  const labels = rateOptionLabels?.length === rates.length ? rateOptionLabels : null;
  const currentLabel = labels
    ? labels[rates.indexOf(playbackRate as (typeof rates)[number])] ?? `${playbackRate}×`
    : `${playbackRate}×`;

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
        "shrink-0 px-3 py-2.5 sm:px-4",
        dockEmbed
          ? "border-t-0 bg-fill/40 backdrop-blur-sm"
          : "border-t border-line bg-fill/60 backdrop-blur-sm"
      ].join(" ")}
    >
      {ratePortal}
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2">
        {keyboardHint ? (
          <p className="text-center text-[10px] text-muted sm:text-left">{keyboardHint}</p>
        ) : null}
        {multiTrackHint ? (
          <p className="text-[9px] leading-snug text-muted sm:text-left">{multiTrackHint}</p>
        ) : null}
        <div className="flex flex-col gap-1">
          <div className="h-12 overflow-hidden rounded-lg border border-line bg-track/50">
            {audioUrl ? (
              <ClipWaveformPanel
                ref={waveformRef as RefObject<ClipWaveformHandle>}
                variant="dock"
                waveHeight={44}
                audioUrl={audioUrl}
                onTimeMs={onTimeMs}
                onLoadError={onLoadError}
                onPlayStateChange={setPlaying}
                playbackRate={playbackRate}
                snapSeekMs={snapSeekMs}
                zoomLevel={zoomLevel}
                className="!border-0 !bg-transparent"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-muted">—</div>
            )}
          </div>
          {audioUrl && mirrorWaveformCount > 0
            ? Array.from({ length: mirrorWaveformCount }, (_, i) => (
                <div
                  key={`mirror-${i}`}
                  className="h-9 overflow-hidden rounded-md border border-line/70 bg-track/35"
                >
                  <ClipWaveformPanel
                    variant="dock"
                    waveHeight={30}
                    audioUrl={audioUrl}
                    onTimeMs={() => {}}
                    playbackRate={playbackRate}
                    zoomLevel={zoomLevel}
                    interactive={false}
                    emitTimeUpdates={false}
                    className="!border-0 !bg-transparent"
                  />
                </div>
              ))
            : null}
        </div>
        {durationMs > 0 ? (
          <div className="px-1">
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={Math.max(0, Math.min(durationMs, currentTimeMs))}
              className="h-2 w-full accent-indigo-500"
              onChange={(e) => onSeekMs?.(Number(e.target.value) || 0)}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
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
          <button
            type="button"
            aria-label={`后退 ${SKIP_SEC} 秒`}
            className="rounded-full border border-line bg-surface p-2 text-ink shadow-soft hover:bg-fill"
            onClick={() => skip(-SKIP_SEC)}
          >
            <Rewind className="h-5 w-5" aria-hidden />
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
            aria-label={`快进 ${SKIP_SEC} 秒`}
            className="rounded-full border border-line bg-surface p-2 text-ink shadow-soft hover:bg-fill"
            onClick={() => skip(SKIP_SEC)}
          >
            <FastForward className="h-5 w-5" aria-hidden />
          </button>
          {onPlaybackRateChange ? (
            <div ref={rateWrapRef} className="relative">
              <button
                ref={rateBtnRef}
                type="button"
                aria-label={rateSelectAriaLabel}
                aria-expanded={rateMenuOpen}
                aria-haspopup="listbox"
                className="inline-flex min-w-[4.5rem] items-center justify-between gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-semibold text-ink shadow-soft hover:bg-fill"
                onClick={(e) => {
                  e.stopPropagation();
                  setRateMenuOpen((o) => !o);
                }}
              >
                <span>{currentLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              </button>
            </div>
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
