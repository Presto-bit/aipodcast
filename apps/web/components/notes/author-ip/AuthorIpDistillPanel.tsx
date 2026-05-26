"use client";

import { useMemo, useState } from "react";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import { buildDistillCenterCloud } from "./distillCenterCloud";
import MaturityTriangleChart from "./MaturityTriangleChart";
import { triangleState } from "./utils";

type Props = {
  item: AuthorIpItem;
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onLearn: () => void;
};

const LEGEND: { kind: string; label: string; color: string }[] = [
  { kind: "profile", label: "定位", color: "#0f766e" },
  { kind: "trait", label: "特色", color: "var(--color-brand, #6366f1)" },
  { kind: "scene", label: "场景", color: "#b45309" },
  { kind: "tag", label: "关键词", color: "#64748b" },
  { kind: "contributor", label: "贡献成稿", color: "#4f46e5" },
  { kind: "insight", label: "变像", color: "#7c3aed" },
  { kind: "meta", label: "摘要", color: "#94a3b8" }
];

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
  const centerItems = useMemo(
    () => buildDistillCenterCloud(item, counts, highlightTags),
    [item, counts, highlightTags]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-br-2xl bg-gradient-to-br from-brand/[0.06] via-surface to-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-l-4 border-brand/60 px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">蒸馏</h2>
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-label="词云图例"
          onClick={() => setHintOpen((v) => !v)}
        >
          ⓘ
        </button>
        {!readOnly ? (
          <button
            type="button"
            title="根据素材 AI 更新词云"
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
            onClick={onLearn}
          >
            <IconRotateCw width={14} height={14} className={busy ? "animate-spin" : ""} aria-hidden />
            更新特色
          </button>
        ) : null}
      </div>
      {hintOpen ? (
        <div className="mx-3 mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
          {LEGEND.map((l) => (
            <span key={l.kind} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 px-1 pb-2">
        <MaturityTriangleChart
          positioning={tri.positioning}
          experience={tri.experience}
          article={tri.article}
          maturity={String(item.maturity)}
          centerItems={centerItems}
        />
      </div>
    </section>
  );
}
