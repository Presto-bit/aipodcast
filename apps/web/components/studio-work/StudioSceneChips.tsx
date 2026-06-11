"use client";

import { STUDIO_SCENE_CHIPS, type StudioSceneChip } from "../../lib/studioSceneChips";

export default function StudioSceneChips({
  onSelect,
  disabled = false
}: {
  onSelect: (chip: StudioSceneChip) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex w-full flex-wrap gap-1.5" role="list" aria-label="写作场景">
      {STUDIO_SCENE_CHIPS.map((chip) => (
        <button
          key={chip.id}
          type="button"
          role="listitem"
          disabled={disabled}
          className={[
            "rounded-full border border-line/70 bg-fill/30 px-2.5 py-1 text-[11px] text-ink/90 transition",
            "hover:border-brand/40 hover:bg-brand/5",
            disabled ? "opacity-50" : ""
          ].join(" ")}
          onClick={() => onSelect(chip)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
