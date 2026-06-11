"use client";

import { studioQuickPrompts } from "../../lib/studioQuickPrompts";
import type { StudioWork } from "../../lib/studioWorkTypes";

export default function StudioEmptyState({
  work,
  onTryPrompt
}: {
  work: StudioWork;
  onTryPrompt: (text: string) => void;
}) {
  const prompts = studioQuickPrompts(work.domain).slice(0, 3);
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-ink">直接描述想写什么</p>
      <p className="mt-1 text-[11px] text-muted">点下方场景快速开始，或直接描述想写什么</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            className="rounded-full border border-line/80 px-3 py-1 text-[11px] text-muted transition hover:border-brand/40 hover:text-ink"
            onClick={() => onTryPrompt(p)}
          >
            {p.length > 28 ? `${p.slice(0, 28)}…` : p}
          </button>
        ))}
      </div>
    </div>
  );
}
