"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type EngineState = "idle" | "queued" | "running" | "ready" | "failed";

function engineDot(st: EngineState): string {
  if (st === "running" || st === "queued") return "bg-warning shadow-[0_0_8px_color-mix(in_srgb,var(--dawn-warning)_45%,transparent)]";
  if (st === "ready") return "bg-mint shadow-[0_0_8px_color-mix(in_srgb,var(--dawn-mint)_40%,transparent)]";
  if (st === "failed") return "bg-danger";
  return "bg-muted";
}

type Props = {
  backHref?: string;
  backLabel?: string;
  title: string;
  engineLabel: string;
  engineState: EngineState;
  transcribeLabel: string;
  exportLabel: string;
  transcribeDisabled: boolean;
  exportDisabled: boolean;
  onTranscribe: () => void;
  onExport: () => void;
  trailing?: ReactNode;
};

export default function PrestoFlowHeader({
  backHref,
  backLabel,
  title,
  engineLabel,
  engineState,
  transcribeLabel,
  exportLabel,
  transcribeDisabled,
  exportDisabled,
  onTranscribe,
  onExport,
  trailing
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-3 backdrop-blur-md sm:h-16 sm:gap-4 sm:px-4">
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className="shrink-0 rounded-md px-2 py-1.5 text-xs text-muted transition hover:bg-fill hover:text-ink"
        >
          {backLabel}
        </Link>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">{title}</h1>
      <div className="hidden items-center gap-2 rounded-full border border-line bg-fill/80 px-3 py-1.5 text-xs text-muted md:flex">
        <span className={`h-2 w-2 shrink-0 rounded-full ${engineDot(engineState)}`} aria-hidden />
        <span className="whitespace-nowrap text-ink">{engineLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={transcribeDisabled}
          onClick={onTranscribe}
          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-40"
        >
          {transcribeLabel}
        </button>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExport}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink shadow-soft hover:bg-fill disabled:opacity-40"
        >
          {exportLabel}
        </button>
      </div>
      {trailing}
    </header>
  );
}
