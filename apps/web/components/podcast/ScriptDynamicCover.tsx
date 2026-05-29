"use client";

import {
  formatScriptCharCountLabel,
  scriptCoverGradientClass,
  scriptCoverInitials,
  scriptGenreChip,
  scriptWorkGenreLabel
} from "../../lib/scriptCardPreview";

type Props = {
  jobId: string;
  title: string;
  jobType: string | undefined;
  charCount: number | null;
  workProgramName?: string;
  /** full：标准网格；mini：侧栏紧凑卡 */
  density?: "full" | "mini";
  className?: string;
};

export function ScriptDynamicCover({
  jobId,
  title,
  jobType,
  charCount,
  workProgramName,
  density = "full",
  className = ""
}: Props) {
  const chip = scriptGenreChip(jobType);
  const genreLabel = scriptWorkGenreLabel({ workProgramName, type: jobType });
  const initials = scriptCoverInitials(title, genreLabel, jobType);
  const charLabel = formatScriptCharCountLabel(charCount);
  const mini = density === "mini";
  const chipCls =
    chip.tone === "social"
      ? "bg-cta/15 text-cta ring-cta/25"
      : "bg-brand/15 text-brand ring-brand/25";

  return (
    <div
      className={`relative aspect-[4/3] min-h-[3.25rem] w-full shrink-0 overflow-hidden ${scriptCoverGradientClass(jobId, jobType)} ${className}`.trim()}
      aria-hidden
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
      <div className={`absolute z-[1] ${mini ? "left-1 top-1" : "left-2 top-2"}`}>
        <span
          className={`inline-flex rounded font-semibold ring-1 ring-inset ${chipCls} ${
            mini ? "px-1 py-px text-[8px]" : "rounded-md px-1.5 py-0.5 text-[10px]"
          }`}
        >
          {chip.label}
        </span>
      </div>
      {charLabel && !mini ? (
        <span className="absolute bottom-2 right-2 z-[1] rounded-md bg-black/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/95 backdrop-blur-[2px]">
          {charLabel}
        </span>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center px-2">
        <span
          className={`select-none font-semibold tracking-wide text-white/90 ${
            mini ? "text-xl" : "text-4xl sm:text-5xl"
          }`}
        >
          {initials}
        </span>
      </div>
    </div>
  );
}
