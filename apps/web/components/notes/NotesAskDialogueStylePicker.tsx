"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  notesAskDialogueStyleHint,
  notesAskDialogueStyleLabel,
  type NotesAskDialogueStyleMode
} from "../../lib/notesAskDialogueStyle";

type Props = {
  value: NotesAskDialogueStyleMode;
  onChange: (mode: NotesAskDialogueStyleMode) => void;
  disabled?: boolean;
  hasNotebookStyle: boolean;
  /** 无笔记本风格时，链至左侧「提炼写作风格」 */
  onRequestLearnStyle?: () => void;
};

function dialogueStyleOptions(hasNotebookStyle: boolean): NotesAskDialogueStyleMode[] {
  return hasNotebookStyle ? ["general", "notebook"] : ["general"];
}

export default function NotesAskDialogueStylePicker({
  value,
  onChange,
  disabled = false,
  hasNotebookStyle,
  onRequestLearnStyle
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const options = dialogueStyleOptions(hasNotebookStyle);
  const canExpand = options.length > 1 && !disabled;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (mode: NotesAskDialogueStyleMode) => {
    onChange(mode);
    setOpen(false);
  };

  const label = notesAskDialogueStyleLabel(value);
  const hint = notesAskDialogueStyleHint(value);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={canExpand ? listId : undefined}
        aria-label={`对话风格：${label}，${hint}`}
        className="flex max-w-[7.5rem] flex-col items-end rounded-xl bg-fill/55 px-1.5 py-1 text-right transition-colors hover:bg-fill/75 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => {
          if (!canExpand) return;
          setOpen((v) => !v);
        }}
      >
        <span className="flex w-full items-center justify-end gap-0.5 leading-none">
          <span className="text-[10px] font-medium text-ink">{label}</span>
          {canExpand ? (
            <span className="text-[8px] text-muted" aria-hidden>
              ▾
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 text-[9px] leading-snug text-muted">{hint}</span>
        {!hasNotebookStyle && onRequestLearnStyle && !disabled ? (
          <span
            role="link"
            tabIndex={0}
            className="mt-0.5 text-[9px] text-brand underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onRequestLearnStyle();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onRequestLearnStyle();
            }}
          >
            去提炼
          </span>
        ) : null}
      </button>
      {open && canExpand ? (
        <div
          id={listId}
          role="listbox"
          aria-label="对话风格"
          className="absolute right-0 bottom-full z-40 mb-1.5 min-w-[7.5rem] overflow-hidden rounded-xl border border-line/50 bg-surface/95 py-0.5 shadow-card backdrop-blur-sm"
        >
          {options.map((mode) => {
            const selected = mode === value;
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={selected}
                className={`block w-full px-2 py-1.5 text-left ${
                  selected ? "bg-fill/80" : "hover:bg-fill"
                }`}
                onClick={() => pick(mode)}
              >
                <span className="block text-[10px] font-medium text-ink">
                  {notesAskDialogueStyleLabel(mode)}
                </span>
                <span className="mt-0.5 block text-[9px] leading-snug text-muted">
                  {notesAskDialogueStyleHint(mode)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
