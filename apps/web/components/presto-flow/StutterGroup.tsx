"use client";

import { useMemo, useState } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import { displayToken } from "../../lib/prestoFlowTranscript";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import WordBlock from "./WordBlock";

type Props = {
  words: ClipWord[];
  excluded: Set<string>;
  playbackWordId: string | null;
  focusedWordId: string | null;
  ariaKeepLabel: string;
  ariaCutLabel: string;
  onToggle: (w: ClipWord) => void;
  onFocusId: (id: string) => void;
  onLongPress: (w: ClipWord, anchor: DOMRect) => void;
  onKeepFirstOnly: (words: ClipWord[]) => void;
  keepFirstLabel: string;
  expandLabel: string;
  markersByWordId?: Readonly<Record<string, TranscriptWordSuggestionMarker>>;
};

export default function StutterGroup({
  words,
  excluded,
  playbackWordId,
  focusedWordId,
  ariaKeepLabel,
  ariaCutLabel,
  onToggle,
  onFocusId,
  onLongPress,
  onKeepFirstOnly,
  keepFirstLabel,
  expandLabel,
  markersByWordId
}: Props) {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const expanded = pinnedOpen || hoverOpen;
  const token = useMemo(() => (words[0] ? displayToken(words[0]) : ""), [words]);
  const first = words[0]!;
  const count = words.length;

  return (
    <span
      className="inline-flex max-w-full flex-col align-baseline sm:inline-flex sm:flex-row sm:flex-wrap sm:items-baseline"
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
    >
      <span
        className={[
          "inline-flex max-w-full flex-wrap items-baseline gap-1 rounded-md border border-line bg-fill/60 px-1 py-0.5",
          expanded ? "ring-1 ring-brand/35" : ""
        ].join(" ")}
      >
        {!expanded ? (
          <>
            <WordBlock
              word={first}
              excluded={excluded.has(first.id)}
              playbackActive={playbackWordId === first.id}
              focused={focusedWordId === first.id}
              ariaKeepLabel={ariaKeepLabel}
              ariaCutLabel={ariaCutLabel}
              onToggle={onToggle}
              onFocusId={onFocusId}
              onLongPress={onLongPress}
              suggestionMarker={markersByWordId?.[first.id]}
            />
            <span className="self-center rounded bg-brand/12 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand">
              ×{count}
            </span>
            <button
              type="button"
              className="self-center rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink hover:bg-fill"
              onClick={(e) => {
                e.stopPropagation();
                onKeepFirstOnly(words);
              }}
            >
              {keepFirstLabel}
            </button>
            <button
              type="button"
              className="self-center text-[10px] font-medium text-brand underline decoration-brand/40 sm:hidden"
              onClick={() => setPinnedOpen(true)}
            >
              {expandLabel}
            </button>
          </>
        ) : (
          <span className="flex flex-wrap items-baseline gap-0.5">
            {words.map((w) => (
              <WordBlock
                key={w.id}
                word={w}
                excluded={excluded.has(w.id)}
                playbackActive={playbackWordId === w.id}
                focused={focusedWordId === w.id}
                ariaKeepLabel={ariaKeepLabel}
                ariaCutLabel={ariaCutLabel}
                onToggle={onToggle}
                onFocusId={onFocusId}
                onLongPress={onLongPress}
                suggestionMarker={markersByWordId?.[w.id]}
              />
            ))}
            <button
              type="button"
              className="ml-1 rounded px-1 py-0.5 text-[10px] text-muted hover:text-ink sm:hidden"
              onClick={() => setPinnedOpen(false)}
            >
              ×
            </button>
          </span>
        )}
      </span>
      {!expanded && token ? (
        <span className="sr-only" aria-live="polite">
          {token} ×{count}
        </span>
      ) : null}
    </span>
  );
}
