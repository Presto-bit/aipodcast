"use client";

import type { MouseEvent, PointerEvent } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import { displayToken } from "../../lib/prestoFlowTranscript";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import WordBlock from "./WordBlock";

type Props = {
  words: ClipWord[];
  excluded: Set<string>;
  playbackWordId: string | null;
  focusedWordId: string | null;
  multiSelectIds: ReadonlySet<string>;
  onRangeDragPointerDown?: (w: ClipWord, e: PointerEvent<HTMLButtonElement>) => void;
  onRangeDragPointerEnter?: (w: ClipWord, e: PointerEvent<HTMLButtonElement>) => void;
  ariaKeepLabel: string;
  ariaCutLabel: string;
  onActivate: (w: ClipWord, e: MouseEvent<HTMLButtonElement>) => void;
  onFocusId: (id: string) => void;
  onLongPress: (w: ClipWord, anchor: DOMRect) => void;
  onKeepFirstOnly?: (words: ClipWord[]) => void;
  keepFirstLabel?: string;
  duplicateWordHint: string;
  groupHoverHint: string;
  markersByWordId?: Readonly<Record<string, TranscriptWordSuggestionMarker>>;
  roughCutHighlightIds?: ReadonlySet<string>;
};

export default function StutterGroup({
  words,
  excluded,
  playbackWordId,
  focusedWordId,
  multiSelectIds,
  onRangeDragPointerDown,
  onRangeDragPointerEnter,
  ariaKeepLabel,
  ariaCutLabel,
  onActivate,
  onFocusId,
  onLongPress,
  onKeepFirstOnly,
  keepFirstLabel,
  duplicateWordHint,
  groupHoverHint,
  markersByWordId,
  roughCutHighlightIds
}: Props) {
  const token = words[0] ? displayToken(words[0]) : "";

  return (
    <span
      className="group/stutter inline-flex max-w-full flex-wrap items-baseline gap-x-0.5 gap-y-1 align-baseline rounded-md border border-dashed border-amber-600/35 bg-amber-500/[0.06] px-1 py-0.5"
      title={groupHoverHint}
    >
      {words.map((w, idx) => (
        <WordBlock
          key={w.id}
          word={w}
          excluded={excluded.has(w.id)}
          playbackActive={playbackWordId === w.id}
          focused={focusedWordId === w.id}
          multiSelectActive={multiSelectIds.has(w.id)}
          trimHintTitle={idx > 0 ? duplicateWordHint : undefined}
          trimExtraClass={
            idx > 0
              ? "underline decoration-dashed decoration-amber-700/70 decoration-2 underline-offset-[3px]"
              : ""
          }
          ariaKeepLabel={ariaKeepLabel}
          ariaCutLabel={ariaCutLabel}
          onActivate={onActivate}
          onFocusId={onFocusId}
          onLongPress={onLongPress}
          onRangeDragPointerDown={onRangeDragPointerDown}
          onRangeDragPointerEnter={onRangeDragPointerEnter}
          suggestionMarker={markersByWordId?.[w.id]}
          roughCutHighlight={Boolean(roughCutHighlightIds?.has(w.id))}
        />
      ))}
      {onKeepFirstOnly && keepFirstLabel ? (
        <button
          type="button"
          className="self-center rounded border border-amber-600/40 bg-surface/90 px-1.5 py-px text-[9px] font-medium text-amber-950 opacity-0 transition-opacity hover:bg-amber-500/15 group-hover/stutter:opacity-100 dark:text-amber-100"
          title={keepFirstLabel}
          onClick={(e) => {
            e.stopPropagation();
            onKeepFirstOnly(words);
          }}
        >
          {keepFirstLabel}
        </button>
      ) : null}
      {token ? (
        <span className="sr-only" aria-live="polite">
          {token} ×{words.length}
        </span>
      ) : null}
    </span>
  );
}
