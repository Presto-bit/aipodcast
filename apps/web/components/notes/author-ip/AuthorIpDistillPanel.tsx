"use client";

import { useState } from "react";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import MaturityTriangleChart from "./MaturityTriangleChart";
import { tagCloudFromItem, traitsFromItem, triangleState, type TraitRow } from "./utils";

type Props = {
  item: AuthorIpItem;
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onLearn: () => void;
};

function TraitBar({ trait }: { trait: TraitRow }) {
  const label = String(trait.label || "").trim() || "—";
  const on = trait.defaultOn !== false;
  const width = on ? 72 : 28;
  return (
    <div className="flex items-center gap-2" title={trait.evidence || label}>
      <div className="h-1.5 flex-1 rounded-full bg-line/50">
        <div className="h-full rounded-full bg-brand/80 transition-all" style={{ width: `${width}%` }} />
      </div>
      <span className="w-24 shrink-0 truncate text-xs text-ink">{label}</span>
    </div>
  );
}

export default function AuthorIpDistillPanel({
  item,
  counts,
  readOnly,
  busy,
  highlightTags,
  onLearn
}: Props) {
  const [hintOpen, setHintOpen] = useState(false);
  const tri = triangleState(item, counts);
  const traits = traitsFromItem(item).slice(0, 6);
  const tags = tagCloudFromItem(item);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-br-2xl bg-gradient-to-br from-brand/[0.06] via-surface to-surface">
      <div className="flex shrink-0 items-center gap-2 border-l-4 border-brand/60 px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">蒸馏</h2>
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-label="说明"
          title="事实与引用请用知识库；本页只学经历与写法"
          onClick={() => setHintOpen((v) => !v)}
        >
          ⓘ
        </button>
        {!readOnly ? (
          <button
            type="button"
            title="刷新学习"
            aria-label="刷新学习"
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
            onClick={onLearn}
          >
            <IconRotateCw width={14} height={14} className={busy ? "animate-spin" : ""} aria-hidden />
            学习
          </button>
        ) : null}
      </div>
      {hintOpen ? (
        <p className="mx-3 mb-1 text-[10px] text-muted">事实与引用请用「知识库」；本页只学经历与写法。词云环绕三角，新词高亮。</p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4">
        <MaturityTriangleChart
          positioning={tri.positioning}
          experience={tri.experience}
          article={tri.article}
          traitsReady={tri.traitsReady}
          maturity={String(item.maturity)}
          tags={tags}
          highlightTags={highlightTags}
        />
        {traits.length > 0 ? (
          <div className="mt-2 space-y-2 px-2">
            <p className="text-xs font-medium text-muted">口吻</p>
            {traits.map((t, i) => (
              <TraitBar key={`${t.label}-${i}`} trait={t} />
            ))}
          </div>
        ) : (
          <p className="mt-2 px-2 text-center text-xs text-muted">添加素材并学习后，将显示提炼出的特色。</p>
        )}
      </div>
    </section>
  );
}
