"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import BrandGlyph from "../brand/BrandGlyph";

function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type Props = {
  title: ReactNode;
  currentMs: number;
  totalMs: number | null;
  exportDisabled: boolean;
  exportLabel: string;
  onExport: () => void;
};

export default function ClipEditorPrdTopBar({
  title,
  currentMs,
  totalMs,
  exportDisabled,
  exportLabel,
  onExport
}: Props) {
  const total = totalMs ?? 0;
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur-md sm:min-h-16 sm:gap-3 sm:px-4">
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 rounded-lg pr-1 transition hover:bg-fill/80"
        aria-label="Presto 首页"
        title="Presto 首页"
      >
        <BrandGlyph size={36} className="rounded-md" />
        <span className="hidden text-sm font-semibold text-ink sm:inline">Presto</span>
      </Link>
      <div className="h-6 w-px shrink-0 bg-line/80" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
        <span className="font-mono text-[11px] tabular-nums text-muted sm:text-xs">
          {formatClock(currentMs)} / {formatClock(total)}
        </span>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExport}
          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-40"
        >
          {exportLabel}
        </button>
        <Link
          href="/clip"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink shadow-soft hover:bg-fill"
        >
          项目空间
        </Link>
      </div>
    </header>
  );
}
