"use client";

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole
} from "@floating-ui/react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";

const LONG_PRESS_MS = 480;

type Props = {
  word: ClipWord;
  excluded: boolean;
  playbackActive: boolean;
  focused: boolean;
  /** 按住左键拖过多个词时扩展多选（由父级协调） */
  onRangeDragPointerDown?: (w: ClipWord, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onRangeDragPointerEnter?: (w: ClipWord, e: ReactPointerEvent<HTMLButtonElement>) => void;
  /** 多选范围高亮 */
  multiSelectActive?: boolean;
  /** 口吃重复等：浏览器原生悬停说明 */
  trimHintTitle?: string;
  /** 附加样式（如重复词下划线） */
  trimExtraClass?: string;
  /** 读屏：保留 / 已标记删除 */
  ariaKeepLabel: string;
  ariaCutLabel: string;
  onActivate: (w: ClipWord, e: React.MouseEvent<HTMLButtonElement>) => void;
  onFocusId: (id: string) => void;
  onLongPress: (w: ClipWord, anchor: DOMRect) => void;
  suggestionMarker?: TranscriptWordSuggestionMarker | null;
  /** 粗剪：口癖 / 搜索命中 */
  roughCutHighlight?: boolean;
};

export default function WordBlock({
  word,
  excluded,
  playbackActive,
  focused,
  multiSelectActive,
  trimHintTitle,
  trimExtraClass,
  ariaKeepLabel,
  ariaCutLabel,
  onActivate,
  onFocusId,
  onLongPress,
  onRangeDragPointerDown,
  onRangeDragPointerEnter,
  suggestionMarker,
  roughCutHighlight
}: Props) {
  const timerRef = useRef<number | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hasSuggestion = Boolean(suggestionMarker);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    if (!suggestionMarker) setCardOpen(false);
  }, [suggestionMarker]);

  const { refs, floatingStyles, context } = useFloating({
    open: hasSuggestion && cardOpen,
    onOpenChange: setCardOpen,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ fallbackPlacements: ["top-start", "bottom-start"] }), shift({ padding: 10 })]
  });

  const hover = useHover(context, {
    enabled: hasSuggestion,
    move: false,
    delay: { open: 40, close: 80 }
  });
  const focus = useFocus(context, { enabled: hasSuggestion });
  const dismiss = useDismiss(context, { enabled: hasSuggestion });
  const role = useRole(context, { role: "tooltip", enabled: hasSuggestion });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const display = `${word.text}${word.punct ?? ""}`.trim() || "\u00a0";

  const suggestionUnderline =
    suggestionMarker?.status === "pending"
      ? "underline decoration-dashed decoration-amber-600/75 decoration-2 underline-offset-[3px]"
      : suggestionMarker?.status === "applied"
        ? "underline decoration-dashed decoration-emerald-600/60 decoration-2 underline-offset-[3px]"
        : "";

  const activePlayback = playbackActive && !excluded;
  const activeSelection = multiSelectActive && !excluded;
  const activeFocus = focused && !excluded;

  const longPressHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      clearTimer();
      const el = e.currentTarget;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onLongPress(word, el.getBoundingClientRect());
      }, LONG_PRESS_MS);
    },
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    onPointerLeave: clearTimer
  };

  const basePointerProps = hasSuggestion ? getReferenceProps(longPressHandlers) : longPressHandlers;
  type BtnPtr = {
    onPointerDown?: (ev: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerEnter?: (ev: ReactPointerEvent<HTMLButtonElement>) => void;
  };
  const bp = basePointerProps as BtnPtr;
  const pointerProps = {
    ...basePointerProps,
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      bp.onPointerDown?.(e);
      onRangeDragPointerDown?.(word, e);
    },
    onPointerEnter: (e: ReactPointerEvent<HTMLButtonElement>) => {
      bp.onPointerEnter?.(e);
      onRangeDragPointerEnter?.(word, e);
    }
  };

  const wordButton = (
    <button
      type="button"
      data-word-id={word.id}
      aria-pressed={excluded}
      aria-label={
        suggestionMarker
          ? `${suggestionMarker.suggestionTitle} — ${excluded ? ariaCutLabel.replace("{text}", display) : ariaKeepLabel.replace("{text}", display)}`
          : excluded
            ? ariaCutLabel.replace("{text}", display)
            : ariaKeepLabel.replace("{text}", display)
      }
      title={trimHintTitle}
      className={[
        "rounded px-0 py-0.5 text-sm leading-normal transition outline-none",
        "hover:bg-brand/12 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        excluded
          ? "opacity-[0.22] line-through decoration-danger/60 text-muted"
          : "text-ink",
        activePlayback ? "z-[2] bg-brand text-brand-foreground shadow-[0_0_14px_color-mix(in_srgb,var(--dawn-brand)_40%,transparent)]" : "",
        !activePlayback && activeSelection ? "z-[1] bg-brand/85 text-brand-foreground" : "",
        !activePlayback && !activeSelection && activeFocus ? "ring-1 ring-brand/70 bg-brand/18 text-ink" : "",
        focused && excluded ? "ring-1 ring-line" : "",
        roughCutHighlight && !excluded ? "ring-2 ring-rose-500/55 ring-offset-1 ring-offset-canvas" : "",
        trimExtraClass || "",
        suggestionUnderline
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => onActivate(word, e)}
      onFocus={() => onFocusId(word.id)}
      {...pointerProps}
    >
      <span className="whitespace-pre-wrap">{word.text}</span>
      {word.punct ? <span className="text-[11px] opacity-75">{word.punct}</span> : null}
    </button>
  );

  if (!suggestionMarker) return wordButton;

  const inlineActionsClass =
    "flex flex-wrap gap-0.5 [@media(hover:hover)_and_(pointer:fine)]:hidden";

  return (
    <span className="inline-flex flex-col items-start gap-0.5 align-baseline">
      {wordButton}
      <span className={inlineActionsClass} role="group">
        {suggestionMarker.status === "pending" ? (
          <button
            type="button"
            className="rounded border border-amber-600/35 bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              suggestionMarker.onApply();
            }}
          >
            {suggestionMarker.applyLabel}
          </button>
        ) : (
          <button
            type="button"
            className="rounded border border-emerald-600/35 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold text-emerald-900 hover:bg-emerald-500/15 dark:text-emerald-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              suggestionMarker.onUndo();
            }}
          >
            {suggestionMarker.undoLabel}
          </button>
        )}
      </span>
      {cardOpen ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[10050] max-h-[min(320px,70vh)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-line bg-surface p-3 text-left text-[11px] leading-relaxed text-ink shadow-soft"
            {...getFloatingProps()}
          >
            <p className="font-semibold text-ink">{suggestionMarker.suggestionTitle}</p>
            <p className="mt-1 text-muted">{suggestionMarker.suggestionBody}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {suggestionMarker.actionsHeading}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {suggestionMarker.status === "pending" ? (
                <button
                  type="button"
                  className="rounded-lg border border-amber-600/40 bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-500/18 dark:text-amber-50"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    suggestionMarker.onApply();
                    setCardOpen(false);
                  }}
                >
                  {suggestionMarker.applyLabel}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg border border-emerald-600/40 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-500/18 dark:text-emerald-50"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    suggestionMarker.onUndo();
                    setCardOpen(false);
                  }}
                >
                  {suggestionMarker.undoLabel}
                </button>
              )}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  );
}
