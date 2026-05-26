"use client";

import { cn } from "../../../lib/cn";
import { TRAIT_DIMENSION_ORDER, type TraitRow } from "./utils";

type Props = {
  traits: TraitRow[];
  readOnly: boolean;
  busy: boolean;
  onToggle: (index: number, on: boolean) => void;
  onRemove: (index: number) => void;
};

function groupWithIndex(traits: TraitRow[]): { dim: string; items: { trait: TraitRow; index: number }[] }[] {
  const map = new Map<string, { trait: TraitRow; index: number }[]>();
  traits.forEach((trait, index) => {
    const dim = String(trait.dimension || "语气").trim() || "语气";
    const list = map.get(dim) ?? [];
    list.push({ trait, index });
    map.set(dim, list);
  });
  const ordered: { dim: string; items: { trait: TraitRow; index: number }[] }[] = [];
  for (const dim of TRAIT_DIMENSION_ORDER) {
    const items = map.get(dim);
    if (items?.length) ordered.push({ dim, items });
  }
  for (const [dim, items] of map) {
    if (!ordered.some((g) => g.dim === dim)) ordered.push({ dim, items });
  }
  return ordered;
}

export default function AuthorIpDistillTraits({ traits, readOnly, busy, onToggle, onRemove }: Props) {
  const groups = groupWithIndex(traits);

  if (traits.length === 0) {
    return (
      <p className="px-2 text-center text-xs text-muted">
        添加素材并点「深度学习」，将从简历与成稿提炼口吻、结构与禁区等特色。
      </p>
    );
  }

  return (
    <div className="space-y-3 px-2 pb-2">
      {groups.map(({ dim, items }) => (
        <div key={dim}>
          <p className="mb-1.5 text-xs font-medium text-muted">{dim}</p>
          <ul className="space-y-2">
            {items.map(({ trait: tr, index }) => {
              const on = tr.defaultOn !== false;
              const label = String(tr.label || "").trim() || "—";
              const ev = String(tr.evidence || "").trim();
              return (
                <li
                  key={`${dim}-${index}`}
                  className={cn(
                    "rounded-lg border px-2.5 py-2",
                    on ? "border-brand/25 bg-brand/[0.04]" : "border-line/50 bg-surface/50 opacity-75"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!readOnly ? (
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={on}
                        disabled={busy}
                        onChange={(e) => onToggle(index, e.target.checked)}
                        aria-label={`启用 ${label}`}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{label}</p>
                      {ev ? (
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-muted" title={ev}>
                          证据：{ev}
                        </p>
                      ) : null}
                    </div>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-muted hover:text-danger-ink"
                        disabled={busy}
                        onClick={() => onRemove(index)}
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
