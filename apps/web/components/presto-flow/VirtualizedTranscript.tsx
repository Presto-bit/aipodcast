"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { ClipWord } from "../../lib/clipTypes";
import { displayToken, type SpeakerLine } from "../../lib/prestoFlowTranscript";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import StutterGroup from "./StutterGroup";
import WordBlock from "./WordBlock";

const EST_LINE_PX = 64;

function linePlainText(line: SpeakerLine): string {
  return line.units
    .map((u) =>
      u.kind === "single" ? displayToken(u.word) : u.words.map((w) => displayToken(w)).join("")
    )
    .join("");
}

function speakerLabel(speaker: number, hostLabel: string, guestLabel: string): string {
  if (speaker === 0) return hostLabel;
  if (speaker === 1) return guestLabel;
  return `S${speaker + 1}`;
}

function lineStartMs(line: SpeakerLine): number | null {
  const first = line.units[0];
  if (!first) return null;
  if (first.kind === "single") return first.word.s_ms;
  return first.words[0]?.s_ms ?? null;
}

function formatLineStart(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export type VirtualizedTranscriptHandle = {
  scrollToWordId: (wordId: string) => void;
};

type Props = {
  lines: SpeakerLine[];
  excluded: Set<string>;
  playbackWordId: string | null;
  /** 与播放进度对应的「句」行索引，用于整句弱高亮 */
  playbackLineIndex?: number | null;
  focusedWordId: string | null;
  multiSelectIds: ReadonlySet<string>;
  onFocusWordId: (id: string) => void;
  onActivateWord: (w: ClipWord, e: MouseEvent<HTMLButtonElement>) => void;
  onRangeDragPointerDown?: (w: ClipWord, e: PointerEvent<HTMLButtonElement>) => void;
  onRangeDragPointerEnter?: (w: ClipWord, e: PointerEvent<HTMLButtonElement>) => void;
  onLongPressWord: (w: ClipWord, rect: DOMRect) => void;
  /** 不传则不显示叠词组「仅保留首词」 */
  onKeepStutterFirst?: (words: ClipWord[]) => void;
  ariaKeepLabel: string;
  ariaCutLabel: string;
  keepFirstLabel?: string;
  hostLabel: string;
  guestLabel: string;
  speakerNames?: Readonly<Record<number, string>>;
  onRenameSpeaker?: (speaker: number, nextName: string) => void;
  emptyLabel: string;
  stutterDupHint: string;
  stutterGroupHint: string;
  /** 词 id → 稿面建议快捷操作（与侧栏同一条建议） */
  markersByWordId?: Readonly<Record<string, TranscriptWordSuggestionMarker>>;
  /** 粗剪：口癖 / 搜索命中高亮 */
  roughCutHighlightIds?: ReadonlySet<string>;
  /** 侧栏已「隐藏」的粗剪键（如 `stutter-*`、`tic:*`）；叠字建议隐藏后稿面不再用叠字组框高亮 */
  dismissedRoughKeys?: ReadonlySet<string>;
  /** 与内部滚动容器同步，供父级拖选 hit-test */
  transcriptScrollRef?: MutableRefObject<HTMLDivElement | null>;
  silenceCards?: ReadonlyArray<{
    key: string;
    start: number;
    end: number;
    cut: boolean;
    capMs: number | null;
    jumpWordId: string | null;
  }>;
  onToggleSilenceCut?: (startMs: number, endMs: number) => void;
  onSetSilenceCapMs?: (startMs: number, endMs: number, capMs: number) => void;
  onJumpToSilence?: (card: { start: number; end: number; jumpWordId: string | null }) => void;
};

const VirtualizedTranscript = forwardRef<VirtualizedTranscriptHandle, Props>(function VirtualizedTranscript(
  {
    lines,
    excluded,
    playbackWordId,
    playbackLineIndex = null,
    focusedWordId,
    multiSelectIds,
    onFocusWordId,
    onActivateWord,
    onRangeDragPointerDown,
    onRangeDragPointerEnter,
    onLongPressWord,
    onKeepStutterFirst,
    ariaKeepLabel,
    ariaCutLabel,
    keepFirstLabel,
    hostLabel,
    guestLabel,
    speakerNames,
    onRenameSpeaker,
    emptyLabel,
    stutterDupHint,
    stutterGroupHint,
    markersByWordId,
    roughCutHighlightIds,
    dismissedRoughKeys,
    transcriptScrollRef,
    silenceCards,
    onToggleSilenceCut,
    onSetSilenceCapMs,
    onJumpToSilence
  },
  ref
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => {
    if (editingSpeaker == null) return;
    const fallback = speakerLabel(editingSpeaker, hostLabel, guestLabel);
    setEditingValue(speakerNames?.[editingSpeaker] ?? fallback);
  }, [editingSpeaker, hostLabel, guestLabel, speakerNames]);

  const commitRename = (speaker: number) => {
    const next = editingValue.trim();
    onRenameSpeaker?.(speaker, next);
    setEditingSpeaker(null);
  };
  const setScrollContainer = (el: HTMLDivElement | null) => {
    parentRef.current = el;
    if (transcriptScrollRef) transcriptScrollRef.current = el;
  };
  const count = lines.length;
  const lineEndMs = (line: SpeakerLine): number => {
    let end = 0;
    for (const u of line.units) {
      if (u.kind === "single") end = Math.max(end, u.word.e_ms);
      else if (u.words.length) end = Math.max(end, u.words[u.words.length - 1]!.e_ms);
    }
    return end;
  };
  const lineStart = (line: SpeakerLine): number => lineStartMs(line) ?? 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => EST_LINE_PX,
    overscan: 12,
    measureElement:
      typeof window !== "undefined" && !navigator.userAgent.includes("Firefox")
        ? (el) => (el as HTMLElement).getBoundingClientRect().height
        : undefined
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToWordId: (wordId: string) => {
        const idx = lines.findIndex((line) =>
          line.units.some((u) =>
            u.kind === "single" ? u.word.id === wordId : u.words.some((w) => w.id === wordId)
          )
        );
        if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
      }
    }),
    [lines, virtualizer]
  );

  if (count === 0) {
    return (
      <div
        ref={setScrollContainer}
        data-presto-transcript-scroll="1"
        className="flex flex-1 items-center justify-center rounded-xl border border-line bg-surface/50 p-8 text-sm text-muted"
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={setScrollContainer}
      data-presto-transcript-scroll="1"
      className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface/50 px-2 py-2"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index];
          if (!line) return null;
          const linePlaybackActive = playbackLineIndex != null && playbackLineIndex === vi.index;
          const speaker = speakerNames?.[line.speaker] ?? speakerLabel(line.speaker, hostLabel, guestLabel);
          const startTimeLabel = formatLineStart(lineStartMs(line));
          const inEdit = editingSpeaker === line.speaker;
          const prevLineEnd = vi.index > 0 ? lineEndMs(lines[vi.index - 1]!) : -1;
          const curLineStart = lineStart(line);
          const inlineSilenceCards = (silenceCards || []).filter((c) => c.start >= prevLineEnd && c.start < curLineStart);
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pr-1"
              style={{
                transform: `translateY(${vi.start}px)`,
                minHeight: EST_LINE_PX
              }}
              role="group"
              aria-label={linePlainText(line)}
              aria-current={linePlaybackActive ? "true" : undefined}
            >
              {inlineSilenceCards.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5 rounded-lg border border-line/60 bg-fill/20 px-2 py-1">
                  {inlineSilenceCards.map((seg) => (
                    <div
                      key={`inline-${seg.key}`}
                      className={[
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]",
                        seg.cut ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-ink"
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        data-silence-start={seg.start}
                        data-silence-end={seg.end}
                        className="font-mono hover:text-brand"
                        onClick={() => onJumpToSilence?.({ start: seg.start, end: seg.end, jumpWordId: seg.jumpWordId })}
                      >
                        {`${formatLineStart(seg.start)}-${formatLineStart(seg.end)}`}
                      </button>
                      <button
                        type="button"
                        data-silence-start={seg.start}
                        data-silence-end={seg.end}
                        className="rounded border border-line/70 px-1 hover:bg-fill"
                        onClick={() => onSetSilenceCapMs?.(seg.start, seg.end, 200)}
                      >
                        200ms
                      </button>
                      <button
                        type="button"
                        data-silence-start={seg.start}
                        data-silence-end={seg.end}
                        className={[
                          "rounded border px-1 hover:bg-fill",
                          seg.capMs === 300 ? "border-brand/50 text-brand" : "border-line/70"
                        ].join(" ")}
                        onClick={() => onSetSilenceCapMs?.(seg.start, seg.end, 300)}
                      >
                        300ms
                      </button>
                      <button
                        type="button"
                        data-silence-start={seg.start}
                        data-silence-end={seg.end}
                        className="rounded border border-line/70 px-1 hover:bg-fill"
                        onClick={() => onSetSilenceCapMs?.(seg.start, seg.end, 500)}
                      >
                        500ms
                      </button>
                      <button
                        type="button"
                        data-silence-start={seg.start}
                        data-silence-end={seg.end}
                        className="rounded border border-line/70 px-1 hover:bg-fill"
                        onClick={() => onToggleSilenceCut?.(seg.start, seg.end)}
                      >
                        {seg.cut ? "恢复" : "剪掉"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="border-b border-line/40 pb-2 pt-1">
                <div className="mb-1.5 flex items-center gap-2 text-left select-none">
                  {inEdit ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => commitRename(line.speaker)}
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(line.speaker);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingSpeaker(null);
                        }
                      }}
                      className="h-5 min-w-[3.5rem] rounded border border-brand/40 bg-surface px-1.5 text-[10px] font-semibold tracking-wide text-brand outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
                    />
                  ) : (
                    <button
                      type="button"
                      className="rounded px-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand hover:bg-brand/10"
                      onDoubleClick={() => setEditingSpeaker(line.speaker)}
                      title="Double click to rename speaker"
                    >
                      {speaker}
                    </button>
                  )}
                  <span className="text-[10px] tabular-nums text-muted">{startTimeLabel}</span>
                </div>
                <div className="min-w-0 whitespace-pre-wrap break-words text-left text-sm leading-normal [word-break:break-word]">
                  <span className="inline-flex flex-wrap content-start gap-x-0 gap-y-0.5">
                  {line.units.flatMap((u) => {
                    if (u.kind === "single") {
                      return [
                        <WordBlock
                          key={u.word.id}
                          word={u.word}
                          excluded={excluded.has(u.word.id)}
                          playbackActive={playbackWordId === u.word.id}
                          focused={focusedWordId === u.word.id}
                          multiSelectActive={multiSelectIds.has(u.word.id)}
                          ariaKeepLabel={ariaKeepLabel}
                          ariaCutLabel={ariaCutLabel}
                          onActivate={onActivateWord}
                          onFocusId={onFocusWordId}
                          onLongPress={onLongPressWord}
                          onRangeDragPointerDown={onRangeDragPointerDown}
                          onRangeDragPointerEnter={onRangeDragPointerEnter}
                          suggestionMarker={markersByWordId?.[u.word.id]}
                          roughCutHighlight={Boolean(roughCutHighlightIds?.has(u.word.id))}
                        />
                      ];
                    }
                    const stutterSuggestionId = `stutter-${u.words[0]!.id}`;
                    if (dismissedRoughKeys?.has(stutterSuggestionId)) {
                      return u.words.map((w) => (
                        <WordBlock
                          key={w.id}
                          word={w}
                          excluded={excluded.has(w.id)}
                          playbackActive={playbackWordId === w.id}
                          focused={focusedWordId === w.id}
                          multiSelectActive={multiSelectIds.has(w.id)}
                          ariaKeepLabel={ariaKeepLabel}
                          ariaCutLabel={ariaCutLabel}
                          onActivate={onActivateWord}
                          onFocusId={onFocusWordId}
                          onLongPress={onLongPressWord}
                          onRangeDragPointerDown={onRangeDragPointerDown}
                          onRangeDragPointerEnter={onRangeDragPointerEnter}
                          suggestionMarker={markersByWordId?.[w.id]}
                          roughCutHighlight={Boolean(roughCutHighlightIds?.has(w.id))}
                        />
                      ));
                    }
                    return [
                      <StutterGroup
                        key={`${u.words[0]!.id}-stutter-${u.words.length}`}
                        words={u.words}
                        excluded={excluded}
                        playbackWordId={playbackWordId}
                        focusedWordId={focusedWordId}
                        multiSelectIds={multiSelectIds}
                        onRangeDragPointerDown={onRangeDragPointerDown}
                        onRangeDragPointerEnter={onRangeDragPointerEnter}
                        ariaKeepLabel={ariaKeepLabel}
                        ariaCutLabel={ariaCutLabel}
                        onActivate={onActivateWord}
                        onFocusId={onFocusWordId}
                        onLongPress={onLongPressWord}
                        onKeepFirstOnly={onKeepStutterFirst}
                        keepFirstLabel={keepFirstLabel}
                        duplicateWordHint={stutterDupHint}
                        groupHoverHint={stutterGroupHint}
                        markersByWordId={markersByWordId}
                        roughCutHighlightIds={roughCutHighlightIds}
                      />
                    ];
                  })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default VirtualizedTranscript;
