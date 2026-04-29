"use client";

import {
  Minus,
  Plus,
  Undo2
} from "lucide-react";
import { type ReactNode } from "react";

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
  return (
    <div className={compact ? "" : "rounded-lg border border-line bg-fill/10 p-2"}>
      <div className={compact ? "flex flex-wrap items-center gap-1.5" : "mb-2 flex flex-wrap items-center gap-1.5"}>
        <ToolButton title="缩小波形" onClick={() => onZoomChange(Math.max(1, zoomLevel - 1))} disabled={disabled || zoomLevel <= 1}>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </ToolButton>
        <span className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2 text-[10px] font-semibold text-muted">
          {zoomLevel}x
        </span>
        <ToolButton title="放大波形" onClick={() => onZoomChange(Math.min(10, zoomLevel + 1))} disabled={disabled || zoomLevel >= 10}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </ToolButton>
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
