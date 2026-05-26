"use client";

import { useMemo, useState } from "react";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem, AuthorIpMaterial } from "../../../lib/authorIp";
import ClusterCloudChart from "./ClusterCloudChart";
import { buildDistillClusterCloud } from "./distillCenterCloud";
import { canUpdateAuthorIpStyle, maturityLabel } from "./utils";

type Props = {
  item: AuthorIpItem;
  materials: AuthorIpMaterial[];
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onLearn: () => void;
};

const LEGEND_COLOR: Record<string, string> = {
  定位: "#0f766e",
  写作风格: "var(--color-brand, #6366f1)",
  场景: "#b45309",
  经历: "#0369a1",
  素材洞察: "#7c3aed"
};

export default function AuthorIpDistillPanel({
  item,
  materials,
  counts,
  readOnly,
  busy,
  highlightTags,
  onLearn
}: Props) {
  const [hintOpen, setHintOpen] = useState(false);

  const clusters = useMemo(
    () => buildDistillClusterCloud(item, counts, highlightTags),
    [item, counts, highlightTags]
  );
  const canLearn = canUpdateAuthorIpStyle(item, materials);

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
            title={canLearn ? "根据参与学习的素材 AI 更新词云" : "请先添加经历或成稿，并确保素材参与风格学习"}
            disabled={busy || !canLearn}
            className={
              canLearn
                ? "ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
                : "ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-line bg-fill/40 px-2.5 py-1 text-xs font-medium text-muted disabled:opacity-60"
            }
            onClick={onLearn}
          >
            <IconRotateCw width={14} height={14} className={busy ? "animate-spin" : ""} aria-hidden />
            更新特色
          </button>
        ) : null}
      </div>
      {hintOpen && clusters.length > 0 ? (
        <div className="mx-3 mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
          {clusters.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: LEGEND_COLOR[c.label] || "#94a3b8" }}
              />
              {c.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 px-1 pb-2">
        <ClusterCloudChart clusters={clusters} maturityLabel={maturityLabel(String(item.maturity))} />
      </div>
    </section>
  );
}
