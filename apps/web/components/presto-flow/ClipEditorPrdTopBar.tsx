"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import BrandGlyph from "../brand/BrandGlyph";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";

type Props = {
  title: ReactNode;
  exportDisabled: boolean;
  exportLabel: string;
  onExport: () => void;
};

export default function ClipEditorPrdTopBar({ title, exportDisabled, exportLabel, onExport }: Props) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur-md sm:min-h-16 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
        <Link
          href={WORKBENCH_HOME_PATH}
          className="flex shrink-0 items-center rounded-lg p-0.5 transition hover:bg-fill/80"
          aria-label="PrestoAI 首页"
          title="PrestoAI 首页"
        >
          <BrandGlyph size={36} className="rounded-md" />
        </Link>
        <span className="hidden shrink-0 text-sm font-medium text-muted sm:inline" aria-hidden>
          |
        </span>
        <div className="min-w-0 flex-1 truncate">{title}</div>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
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
