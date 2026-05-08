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
  /** 粗剪后：保留内容对应的有效时长（原始素材总长减去已删词块时长估算） */
  processedDurationMs: number | null;
  /** 素材区合并后的原始总时长（转写 duration 或按字节粗估） */
  sourceMaterialDurationMs: number | null;
  exportDisabled: boolean;
  exportLabel: string;
  onExport: () => void;
};

function formatMaybeClock(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return formatClock(Math.round(ms));
}

export default function ClipEditorPrdTopBar({
  title,
  processedDurationMs,
  sourceMaterialDurationMs,
  exportDisabled,
  exportLabel,
  onExport
}: Props) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur-md sm:min-h-16 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-lg p-0.5 transition hover:bg-fill/80"
          aria-label="Presto 首页"
          title="Presto 首页"
        >
          <BrandGlyph size={36} className="rounded-md" />
        </Link>
        <span className="hidden shrink-0 text-sm font-medium text-muted sm:inline" aria-hidden>
          |
        </span>
        <div className="min-w-0 flex-1 truncate">{title}</div>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
        <span
          className="font-mono text-[11px] tabular-nums text-muted sm:text-xs"
          title="粗剪后有效时长 / 上传合并的原始素材总时长（词块删除会从左侧估算扣减）"
        >
          {formatMaybeClock(processedDurationMs)} / {formatMaybeClock(sourceMaterialDurationMs)}
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
