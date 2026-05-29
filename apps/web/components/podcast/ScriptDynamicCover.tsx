"use client";

import {
  formatScriptCharCountLabel,
  scriptCoverGradientClass,
  scriptCoverInitials,
  scriptGenreChip
} from "../../lib/scriptCardPreview";

type Props = {
  jobId: string;
  title: string;
  jobType: string | undefined;
  charCount: number | null;
  /** full：标准网格；mini：侧栏单列 */
  density?: "full" | "mini";
  className?: string;
};

export function ScriptDynamicCover({
  jobId,
  title,
  jobType,
  charCount,
  density = "full",
  className = ""
}: Props) {
  const chip = scriptGenreChip(jobType);
  const initials = scriptCoverInitials(title);
  const charLabel = formatScriptCharCountLabel(charCount);
  const mini = density === "mini";
  const chipCls =
    chip.tone === "social"
      ? "bg-cta/15 text-cta ring-cta/25"
      : "bg-brand/15 text-brand ring-brand/25";

  return (
    <div
      className={`relative aspect-[4/3] w-full shrink-0 overflow-hidden ${scriptCoverGradientClass(jobId)} ${className}`.trim()}
      aria-hidden
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
      <div className="absolute left-2 top-2 z-[1]">
        <span
          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${chipCls}`}
        >
          {chip.label}
        </span>
      </div>
      {charLabel ? (
        <span className="absolute bottom-2 right-2 z-[1] rounded-md bg-black/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/95 backdrop-blur-[2px]">
          {charLabel}
        </span>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center px-3">
        <span
          className={`select-none font-semibold tracking-wide text-white/90 ${
            mini ? "text-3xl" : "text-4xl sm:text-5xl"
          }`}
        >
          {initials}
        </span>
      </div>
    </div>
  );
}
