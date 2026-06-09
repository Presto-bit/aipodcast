"use client";

import type { StudioDomain } from "../../lib/studioDomainProfile";
import { studioDomainLabel } from "../../lib/studioDomainProfile";
import type { StudioEditorMode } from "../../lib/studioEditorMode";

const DOMAINS: StudioDomain[] = [
  "general",
  "article",
  "business",
  "script",
  "narrative",
  "social"
];

export default function StudioEditorControls({
  editorMode,
  domain,
  onEditorModeChange,
  onDomainChange
}: {
  editorMode: StudioEditorMode;
  domain?: StudioDomain;
  onEditorModeChange: (mode: StudioEditorMode) => void;
  onDomainChange: (domain: StudioDomain) => void;
}) {
  const d = domain ?? "general";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      <div className="inline-flex rounded-md border border-line/70 p-0.5">
        <button
          type="button"
          className={[
            "rounded px-2 py-0.5 transition",
            editorMode === "explore" ? "bg-brand/15 text-brand font-medium" : "text-muted hover:text-ink"
          ].join(" ")}
          onClick={() => onEditorModeChange("explore")}
          title="探索：首稿与改版均自动采纳"
        >
          探索
        </button>
        <button
          type="button"
          className={[
            "rounded px-2 py-0.5 transition",
            editorMode === "review" ? "bg-brand/15 text-brand font-medium" : "text-muted hover:text-ink"
          ].join(" ")}
          onClick={() => onEditorModeChange("review")}
          title="审阅：改版需确认，首稿自动落稿"
        >
          审阅
        </button>
      </div>
      <select
        value={d}
        onChange={(e) => onDomainChange(e.target.value as StudioDomain)}
        className="max-w-[5.5rem] truncate rounded-md border border-line/70 bg-surface px-1.5 py-0.5 text-[10px] text-muted"
        aria-label="写作领域"
        title="写作领域"
      >
        {DOMAINS.map((id) => (
          <option key={id} value={id}>
            {studioDomainLabel(id)}
          </option>
        ))}
      </select>
    </div>
  );
}
