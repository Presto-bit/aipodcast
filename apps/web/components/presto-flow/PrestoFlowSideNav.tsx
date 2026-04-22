"use client";

import { Download, Layers, Music } from "lucide-react";
import type { ReactNode } from "react";

import type { PrestoNavSection } from "./prestoFlowNavTypes";

export type { PrestoNavSection } from "./prestoFlowNavTypes";

type Props = {
  active: PrestoNavSection;
  onSelect: (s: PrestoNavSection) => void;
  onDownloadClick: () => void;
  hasExportUrl: boolean;
  labels: { storyboard: string; music: string; download: string };
};

export default function PrestoFlowSideNav({ active, onSelect, onDownloadClick, hasExportUrl, labels }: Props) {
  const btn = (id: PrestoNavSection, icon: ReactNode, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active === id}
      title={label}
      onClick={() => onSelect(id)}
      className={[
        "flex h-11 w-11 items-center justify-center rounded-lg transition",
        active === id
          ? "bg-brand/15 text-brand shadow-inset-brand"
          : "text-muted hover:bg-fill hover:text-ink"
      ].join(" ")}
    >
      {icon}
    </button>
  );

  return (
    <nav
      className="relative z-20 flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-fill/40 py-3 sm:w-16"
      aria-label="Presto Flow"
    >
      {btn("storyboard", <Layers className="h-5 w-5" aria-hidden />, labels.storyboard)}
      {btn("music", <Music className="h-5 w-5" aria-hidden />, labels.music)}
      <div className="flex-1" />
      <button
        type="button"
        aria-label={labels.download}
        title={labels.download}
        disabled={!hasExportUrl}
        onClick={onDownloadClick}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-fill hover:text-ink disabled:opacity-35"
      >
        <Download className="h-5 w-5" aria-hidden />
      </button>
    </nav>
  );
}
