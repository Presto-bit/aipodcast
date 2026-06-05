"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const PRESETS = [
  { label: "更口语", opinion: "更口语、像朋友聊天" },
  { label: "更短", opinion: "更短、删掉废话" },
  { label: "更抓人", opinion: "更抓人、加强开头钩子" }
] as const;

/** 选区浮动工具条：选中文稿片段后快速改版（主路径） */
export default function StudioSelectionToolbar({
  anchorRef,
  selectedText,
  onRevise,
  onDismiss,
  busy = false
}: {
  anchorRef: RefObject<HTMLElement | null>;
  selectedText: string;
  onRevise: (opinion: string) => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customOpinion, setCustomOpinion] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const top = Math.max(8, rect.top - 44);
    const left = Math.min(window.innerWidth - 280, Math.max(8, rect.left));
    setPos({ top, left });
  }, [selectedText, anchorRef]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onDismiss();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [anchorRef, onDismiss]);

  if (!pos || !selectedText.trim()) return null;

  return (
    <div
      ref={barRef}
      className="fixed z-50 flex max-w-[min(92vw,360px)] flex-col gap-1 rounded-xl border border-line/70 bg-surface p-1.5 shadow-lg"
      style={{ top: pos.top, left: pos.left }}
      role="toolbar"
      aria-label="选区改版"
    >
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            className="rounded-md bg-fill px-2 py-1 text-[11px] text-ink hover:bg-fill/80 disabled:opacity-50"
            onClick={() => onRevise(p.opinion)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-[11px] text-muted"
          onClick={() => setCustomOpen((o) => !o)}
        >
          自定义
        </button>
      </div>
      {customOpen ? (
        <div className="flex gap-1 border-t border-line/40 pt-1">
          <input
            className="min-w-0 flex-1 rounded-md border border-line/60 bg-fill/30 px-2 py-1 text-[11px] outline-none"
            placeholder="改写要求"
            value={customOpinion}
            onChange={(e) => setCustomOpinion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customOpinion.trim()) {
                onRevise(customOpinion.trim());
              }
            }}
          />
          <button
            type="button"
            disabled={!customOpinion.trim() || busy}
            className="rounded-md bg-brand px-2 py-1 text-[11px] text-brand-foreground disabled:opacity-50"
            onClick={() => onRevise(customOpinion.trim())}
          >
            改
          </button>
        </div>
      ) : null}
    </div>
  );
}
