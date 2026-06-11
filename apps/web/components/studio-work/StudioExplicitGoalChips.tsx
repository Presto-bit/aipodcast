"use client";

import type { StudioExplicitGoal } from "../../lib/studioExplicitGoal";
import { studioExplicitGoalLabel, STUDIO_EXPLICIT_GOALS } from "../../lib/studioExplicitGoal";

/** 本轮目标：写稿 / 改版 / 问答（Planner 读 explicitGoal，auto 为默认） */
export default function StudioExplicitGoalChips({
  goal,
  onChange,
  disabled = false
}: {
  goal: StudioExplicitGoal;
  onChange: (goal: StudioExplicitGoal) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="mb-2 flex w-full flex-wrap gap-1 rounded-lg border border-line/60 bg-fill/20 p-0.5"
      role="tablist"
      aria-label="本轮目标"
    >
      {STUDIO_EXPLICIT_GOALS.map((item) => {
        const active = goal === item;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            className={[
              "rounded-md px-2 py-1 text-[11px] font-medium transition",
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              disabled ? "opacity-50" : ""
            ].join(" ")}
            onClick={() => onChange(item)}
          >
            {studioExplicitGoalLabel(item)}
          </button>
        );
      })}
    </div>
  );
}
