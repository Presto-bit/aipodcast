"use client";

import type { StudioAgentMode } from "../../lib/studioAgentMode";
import { studioAgentModeLabel } from "../../lib/studioAgentMode";

/** Cursor 式 Ask / Write 模式切换 */
export default function StudioAgentModeToggle({
  mode,
  onChange,
  disabled = false
}: {
  mode: StudioAgentMode;
  onChange: (mode: StudioAgentMode) => void;
  disabled?: boolean;
}) {
  const items: StudioAgentMode[] = ["ask", "write"];
  return (
    <div
      className="mb-2 flex w-full gap-1 rounded-lg border border-line/60 bg-fill/20 p-0.5"
      role="tablist"
      aria-label="Agent 模式"
    >
      {items.map((item) => {
        const active = mode === item;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            className={[
              "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              active
                ? "bg-surface text-ink shadow-sm"
                : "text-muted hover:text-ink",
              disabled ? "opacity-50" : ""
            ].join(" ")}
            onClick={() => onChange(item)}
          >
            {studioAgentModeLabel(item)}
          </button>
        );
      })}
    </div>
  );
}
