"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronLeft, NotebookIcon, NOTEBOOK_ICON_COUNT } from "../icons";
import { resolveNotebookCardVisual, type NotebookCardVisual } from "../../lib/notebookCardThemes";

type SharedBrowse = {
  access: "read_only" | "edit";
};

type Props = {
  selectedNotebook: string;
  notebooks: string[];
  notebookVisualByName: Record<string, NotebookCardVisual>;
  sharedBrowse?: SharedBrowse | null;
  onBackToHub: () => void;
  onOpenNotebook: (name: string) => void;
  onNewNotebook: () => void;
};

export default function NotebookWorkbenchHeader({
  selectedNotebook,
  notebooks,
  notebookVisualByName,
  sharedBrowse,
  onBackToHub,
  onOpenNotebook,
  onNewNotebook
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const nb = selectedNotebook.trim();
  const canSwitch = !sharedBrowse && notebooks.length >= 1;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentVisual = resolveNotebookCardVisual(notebookVisualByName[nb]);

  const pick = (name: string) => {
    onOpenNotebook(name);
    setOpen(false);
  };

  return (
    <header className="sticky top-0 z-20 mb-3 flex min-w-0 items-center gap-2 border-b border-line/50 bg-canvas/90 py-2.5 backdrop-blur-sm">
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-fill hover:text-ink"
        onClick={onBackToHub}
        aria-label="返回知识库笔记本列表"
      >
        <IconChevronLeft width={18} height={18} aria-hidden />
        <span>知识库</span>
      </button>

      <span className="shrink-0 text-muted/60" aria-hidden>
        /
      </span>

      {sharedBrowse ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-ink" title={nb}>
            {nb}
          </p>
          <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-[10px] font-medium text-muted">
            {sharedBrowse.access === "edit" ? "他人分享 · 可编辑" : "他人分享 · 只读"}
          </span>
        </div>
      ) : canSwitch ? (
        <div className="relative min-w-0 flex-1" ref={rootRef}>
          <button
            type="button"
            className="flex max-w-full items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 text-left transition-colors hover:border-line/60 hover:bg-fill/60"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${currentVisual.theme.iconWrap}`}
              aria-hidden
            >
              <NotebookIcon index={currentVisual.iconIndex} width={18} height={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{nb}</span>
            <span className="shrink-0 text-[10px] text-muted" aria-hidden>
              ▾
            </span>
          </button>
          {open ? (
            <div
              id={listId}
              role="listbox"
              aria-label="切换笔记本"
              className="absolute left-0 top-full z-40 mt-1 max-h-[min(16rem,50dvh)] w-[min(100%,18rem)] overflow-y-auto rounded-xl border border-line/70 bg-surface py-1 shadow-card"
            >
              {notebooks.map((name) => {
                const visual = resolveNotebookCardVisual(notebookVisualByName[name]);
                const selected = name === nb;
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm ${
                      selected ? "bg-fill/90" : "hover:bg-fill"
                    }`}
                    onClick={() => pick(name)}
                  >
                    <span
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${visual.theme.iconWrap}`}
                      aria-hidden
                    >
                      <NotebookIcon index={visual.iconIndex % NOTEBOOK_ICON_COUNT} width={16} height={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
                  </button>
                );
              })}
              <div className="my-0.5 border-t border-line/60" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium text-brand hover:bg-fill"
                onClick={() => {
                  setOpen(false);
                  onNewNotebook();
                }}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-brand/40 text-brand">
                  +
                </span>
                新建笔记本
              </button>
            </div>
          ) : null}
        </div>
      ) : nb ? (
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={nb}>
          {nb}
        </p>
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-sm font-semibold text-brand hover:bg-brand/8"
          onClick={onNewNotebook}
        >
          + 新建笔记本
        </button>
      )}
    </header>
  );
}
