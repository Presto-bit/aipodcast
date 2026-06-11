"use client";

import { STUDIO_NEW_AGENT_SCENE_CHIPS, type StudioSceneChip } from "../../lib/studioSceneChips";

export default function StudioSceneChips({
  onSelect,
  disabled = false,
  chips = STUDIO_NEW_AGENT_SCENE_CHIPS
}: {
  onSelect: (chip: StudioSceneChip) => void;
  disabled?: boolean;
  chips?: StudioSceneChip[];
}) {
  if (!chips.length) return null;

  return (
    <div className="mb-2 flex w-full flex-wrap justify-center gap-1.5" role="list" aria-label="写作场景">
      {chips.map((chip) => (
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
