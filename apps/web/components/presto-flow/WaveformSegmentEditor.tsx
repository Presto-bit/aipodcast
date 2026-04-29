"use client";

import {
  ChevronDown,
  Undo2
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  zoomLevel: number;
  onZoomChange: (next: number) => void;
  onSplit: () => void;
  onSplitLeft: () => void;
  onSplitRight: () => void;
  onUndo: () => void;
  undoDisabled?: boolean;
  disabled?: boolean;
  compact?: boolean;
};

function ToolButton({
  title,
  onClick,
  disabled,
  children
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CutModeIcon({ mode }: { mode: "split" | "left" | "right" }) {
  const leftMuted = mode === "right";
  const rightMuted = mode === "left";
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center text-ink">
      <span className="absolute bottom-[1px] left-1/2 h-[8px] w-0 -translate-x-1/2 border-l border-current" />
      <span
        className={[
          "absolute left-1/2 top-[2px] h-0 w-[7px] -translate-x-[7px] rotate-[28deg] border-t",
          leftMuted ? "border-line/70" : "border-current"
        ].join(" ")}
      />
      <span
        className={[
          "absolute left-1/2 top-[2px] h-0 w-[7px] -rotate-[28deg] border-t",
          rightMuted ? "border-line/70" : "border-current"
        ].join(" ")}
      />
    </span>
  );
}

export default function WaveformSegmentEditor({
  zoomLevel,
  onZoomChange,
  onSplit,
  onSplitLeft,
  onSplitRight,
  onUndo,
  undoDisabled,
  disabled = false,
  compact = false
}: Props) {
  const [zoomPopoverOpen, setZoomPopoverOpen] = useState(false);
  const [zoomPopoverPlacement, setZoomPopoverPlacement] = useState<"top" | "bottom">("bottom");
  const zoomWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!zoomPopoverOpen) return;
    const recalcPlacement = () => {
      const el = zoomWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const panelH = 116;
      const gap = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const spaceAbove = r.top - gap;
      if (spaceBelow < panelH && spaceAbove > spaceBelow) setZoomPopoverPlacement("top");
      else setZoomPopoverPlacement("bottom");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomPopoverOpen(false);
    };
    recalcPlacement();
    window.addEventListener("resize", recalcPlacement);
    window.addEventListener("scroll", recalcPlacement, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", recalcPlacement);
      window.removeEventListener("scroll", recalcPlacement, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomPopoverOpen]);

  return (
    <div className={compact ? "" : "rounded-lg border border-line bg-fill/10 p-2"}>
      <div className={compact ? "flex flex-wrap flex-row-reverse items-center gap-1.5" : "mb-2 flex flex-wrap items-center gap-1.5"}>
        <div ref={zoomWrapRef} className="relative">
          <button
            type="button"
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => setZoomPopoverOpen((v) => !v)}
          >
            <span>{zoomLevel}x</span>
            <ChevronDown className="h-3 w-3" aria-hidden />
          </button>
          {zoomPopoverOpen ? (
            <div
              className={[
                "absolute left-0 z-[260] min-w-[220px] rounded-md border border-line bg-surface p-2 shadow-lg",
                zoomPopoverPlacement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+6px)]"
              ].join(" ")}
            >
          <p className="mb-2 text-[10px] text-muted">左右拖动缩放波形（1x~10x）</p>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={zoomLevel}
                className="h-2 w-full cursor-ew-resize accent-brand"
                onChange={(e) => onZoomChange(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              />
            </div>
          ) : null}
        </div>
        <ToolButton title="分割（在光标处切成两段）" onClick={onSplit} disabled={disabled}>
          <CutModeIcon mode="split" />
        </ToolButton>
        <ToolButton title="左分割（保留左侧，右侧删除）" onClick={onSplitLeft} disabled={disabled}>
          <CutModeIcon mode="left" />
        </ToolButton>
        <ToolButton title="右分割（保留右侧，左侧删除）" onClick={onSplitRight} disabled={disabled}>
          <CutModeIcon mode="right" />
        </ToolButton>
        <ToolButton title="撤销" onClick={onUndo} disabled={disabled || undoDisabled}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
        </ToolButton>
      </div>
    </div>
  );
}
