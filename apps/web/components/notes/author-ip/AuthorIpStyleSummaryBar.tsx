"use client";

import type { AuthorIpItem, AuthorIpMaterial } from "../../../lib/authorIp";
import {
  buildStyleSummaryChips,
  buildStyleSummaryText,
  countLearningMaterials,
  formatLastLearnedAt,
  readinessUserLabel,
  vitalityFromItem
} from "./utils";

type Props = {
  item: AuthorIpItem;
  materials: AuthorIpMaterial[];
  onOpenProfile: () => void;
};

export default function AuthorIpStyleSummaryBar({ item, materials, onOpenProfile }: Props) {
  const status = readinessUserLabel(String(item.maturity));
  const learningN = countLearningMaterials(materials);
  const summary = buildStyleSummaryText(item);
  const chips = buildStyleSummaryChips(item, 6);
  const extraChipCount = Math.max(0, buildStyleSummaryChips(item, 20).length - chips.length);
  const v = vitalityFromItem(item);
  const learned = formatLastLearnedAt(v?.lastLearnedAt);

  const statusDot =
    status === "已就绪" ? "bg-brand" : status === "学习中" ? "bg-amber-500" : "bg-line";

  return (
    <div className="rounded-2xl border border-line/80 bg-gradient-to-br from-brand/[0.05] via-surface to-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden />
          {status}
        </span>
        <span>{learningN > 0 ? `${learningN} 篇参与学习` : "暂无参与学习的素材"}</span>
        {learned ? <span>上次更新 {learned}</span> : null}
        <button type="button" className="ml-auto text-brand hover:underline" onClick={onOpenProfile}>
          展开风格档案
        </button>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink">{summary}</p>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-md border border-line/80 bg-canvas/80 px-2 py-0.5 text-[11px] font-medium text-ink"
            >
              {c}
            </span>
          ))}
          {extraChipCount > 0 ? (
            <span className="rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] text-muted">
              +{extraChipCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
