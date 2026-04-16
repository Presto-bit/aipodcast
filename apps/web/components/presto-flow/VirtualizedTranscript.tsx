"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useImperativeHandle, useRef } from "react";
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

export type VirtualizedTranscriptHandle = {
  scrollToWordId: (wordId: string) => void;
};

type Props = {
  lines: SpeakerLine[];
  excluded: Set<string>;
  playbackWordId: string | null;
  focusedWordId: string | null;
  onFocusWordId: (id: string) => void;
  onToggleWord: (w: ClipWord) => void;
  onLongPressWord: (w: ClipWord, rect: DOMRect) => void;
  onKeepStutterFirst: (words: ClipWord[]) => void;
  ariaKeepLabel: string;
  ariaCutLabel: string;
  keepFirstLabel: string;
  expandLabel: string;
  hostLabel: string;
  guestLabel: string;
  emptyLabel: string;
  /** 词 id → 稿面建议快捷操作（与侧栏同一条建议） */
  markersByWordId?: Readonly<Record<string, TranscriptWordSuggestionMarker>>;
};

const VirtualizedTranscript = forwardRef<VirtualizedTranscriptHandle, Props>(function VirtualizedTranscript(
  {
    lines,
    excluded,
    playbackWordId,
    focusedWordId,
    onFocusWordId,
    onToggleWord,
    onLongPressWord,
    onKeepStutterFirst,
    ariaKeepLabel,
    ariaCutLabel,
    keepFirstLabel,
    expandLabel,
    hostLabel,
    guestLabel,
    emptyLabel,
    markersByWordId
  },
  ref
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const count = lines.length;

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
        if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
      }
    }),
    [lines, virtualizer]
  );

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-line bg-surface/50 p-8 text-sm text-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface/50 px-2 py-2"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index];
          if (!line) return null;
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
            >
              <div className="flex gap-2 border-b border-line/40 pb-2 pt-1">
                <span className="mt-0.5 w-14 shrink-0 select-none text-[10px] font-semibold uppercase tracking-wide text-brand">
                  {speakerLabel(line.speaker, hostLabel, guestLabel)}
                </span>
                <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left leading-relaxed [word-break:break-word]">
                  <span className="inline-flex flex-wrap content-start gap-x-0.5 gap-y-1">
                  {line.units.map((u) =>
                    u.kind === "single" ? (
                      <WordBlock
                        key={u.word.id}
                        word={u.word}
                        excluded={excluded.has(u.word.id)}
                        playbackActive={playbackWordId === u.word.id}
                        focused={focusedWordId === u.word.id}
                        ariaKeepLabel={ariaKeepLabel}
                        ariaCutLabel={ariaCutLabel}
                        onToggle={onToggleWord}
                        onFocusId={onFocusWordId}
                        onLongPress={onLongPressWord}
                        suggestionMarker={markersByWordId?.[u.word.id]}
                      />
                    ) : (
                      <StutterGroup
                        key={`${u.words[0]!.id}-stutter-${u.words.length}`}
                        words={u.words}
                        excluded={excluded}
                        playbackWordId={playbackWordId}
                        focusedWordId={focusedWordId}
                        ariaKeepLabel={ariaKeepLabel}
                        ariaCutLabel={ariaCutLabel}
                        onToggle={onToggleWord}
                        onFocusId={onFocusWordId}
                        onLongPress={onLongPressWord}
                        onKeepFirstOnly={onKeepStutterFirst}
                        keepFirstLabel={keepFirstLabel}
                        expandLabel={expandLabel}
                        markersByWordId={markersByWordId}
                      />
                    )
                  )}
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
