"use client";

import type { StudioReviseTier } from "../../lib/studioReviseTier";
import {
  normalizeStudioReviseTier,
  STUDIO_REVISE_TIERS,
  studioReviseTierLabel
} from "../../lib/studioReviseTier";

/** 有选区或改版意图时：保守 / 标准 / 强力 */
export default function StudioReviseTierChips({
  tier,
  onChange,
  disabled = false
}: {
  tier: StudioReviseTier;
  onChange: (tier: StudioReviseTier) => void;
  disabled?: boolean;
}) {
  const active = normalizeStudioReviseTier(tier);
  return (
    <div
      className="mb-2 flex w-full flex-wrap items-center gap-1 rounded-lg border border-dashed border-line/50 bg-fill/10 px-1 py-0.5"
      role="tablist"
      aria-label="改写力度"
    >
      <span className="px-1 text-[10px] text-muted">改写</span>
      {STUDIO_REVISE_TIERS.map((item) => {
        const selected = active === item;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            className={[
              "rounded-md px-2 py-0.5 text-[11px] font-medium transition",
              selected ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              disabled ? "opacity-50" : ""
            ].join(" ")}
            onClick={() => onChange(item)}
          >
            {studioReviseTierLabel(item)}
          </button>
        );
      })}
    </div>
  );
}
