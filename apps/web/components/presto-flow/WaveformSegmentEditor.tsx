"use client";

import {
  Minus,
  Plus,
  Scissors,
  Split,
  Undo2
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

export type WaveformSegmentItem = {
  id: string;
  startMs: number;
  endMs: number;
  source: "original" | "inserted";
  transcribed: boolean;
};

type Props = {
  segments: WaveformSegmentItem[];
  zoomLevel: number;
  onZoomChange: (next: number) => void;
  onSplit: () => void;
  onSplitLeft: () => void;
  onSplitRight: () => void;
  onUndo: () => void;
  undoDisabled?: boolean;
  onInsertAtBoundary: (boundaryIndex: number) => void;
  onReorder: (fromId: string, toId: string) => void;
  activeDropSegmentId?: string | null;
  onHoverDropTarget?: (segmentId: string | null) => void;
  disabled?: boolean;
};

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
      className="rounded-md border border-line bg-surface p-1.5 text-ink hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function WaveformSegmentEditor({
  segments,
  zoomLevel,
  onZoomChange,
  onSplit,
  onSplitLeft,
  onSplitRight,
  onUndo,
  undoDisabled,
  onInsertAtBoundary,
  onReorder,
  activeDropSegmentId,
  onHoverDropTarget,
  disabled = false
}: Props) {
  const totalMs = useMemo(() => {
    if (!segments.length) return 0;
    return Math.max(...segments.map((x) => x.endMs), 0);
  }, [segments]);

  return (
    <div className="rounded-lg border border-line bg-fill/10 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ToolButton
          title="缩小波形"
          onClick={() => onZoomChange(Math.max(1, zoomLevel - 1))}
          disabled={disabled}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </ToolButton>
        <span className="rounded-md border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-muted">
          {zoomLevel}x
        </span>
        <ToolButton
          title="放大波形"
          onClick={() => onZoomChange(Math.min(10, zoomLevel + 1))}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton title="分割" onClick={onSplit} disabled={disabled}>
          <Scissors className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton title="左分割" onClick={onSplitLeft} disabled={disabled}>
          <Split className="h-4 w-4 -scale-x-100" aria-hidden />
        </ToolButton>
        <ToolButton title="右分割" onClick={onSplitRight} disabled={disabled}>
          <Split className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton title="撤销" onClick={onUndo} disabled={disabled || undoDisabled}>
          <Undo2 className="h-4 w-4" aria-hidden />
        </ToolButton>
      </div>

      <div className="flex h-12 items-stretch overflow-hidden rounded-md border border-line bg-canvas/50">
        {segments.map((seg, idx) => {
          const widthPct = totalMs > 0 ? Math.max(6, ((seg.endMs - seg.startMs) / totalMs) * 100) : 100;
          return (
            <div
              key={seg.id}
              className={[
                "group relative flex h-full min-w-[5rem] border-r border-line/60 transition",
                activeDropSegmentId === seg.id ? "ring-1 ring-brand/60" : ""
              ].join(" ")}
              style={{ width: `${widthPct}%` }}
              draggable={!disabled}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", seg.id)}
              onDragEnter={() => onHoverDropTarget?.(seg.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain");
                if (fromId) onReorder(fromId, seg.id);
              }}
              onDragLeave={() => onHoverDropTarget?.(null)}
            >
              <button
                type="button"
                className="absolute -left-2 top-1/2 z-[2] hidden h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-brand/50 bg-brand text-[10px] text-brand-foreground group-hover:inline-flex"
                onClick={() => onInsertAtBoundary(idx)}
                aria-label="在该位置插入音频"
                title="在该位置插入音频"
                disabled={disabled}
              >
                +
              </button>
              <button
                type="button"
                className={[
                  "flex h-full w-full flex-col items-start justify-center px-2 text-left text-[10px]",
                  seg.source === "inserted" ? "bg-brand/20" : "bg-brand/10"
                ].join(" ")}
                title={`${formatMs(seg.startMs)} - ${formatMs(seg.endMs)}`}
              >
                <span className="font-medium text-ink">
                  {seg.source === "inserted" ? "新片段" : "原片段"}
                </span>
                <span className="text-muted">
                  {seg.transcribed ? "已转写" : "未转写"}
                </span>
              </button>
              {idx === segments.length - 1 ? (
                <button
                  type="button"
                  className="absolute -right-2 top-1/2 z-[2] hidden h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-brand/50 bg-brand text-[10px] text-brand-foreground group-hover:inline-flex"
                  onClick={() => onInsertAtBoundary(idx + 1)}
                  aria-label="在该位置插入音频"
                  title="在该位置插入音频"
                  disabled={disabled}
                >
                  +
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
