"use client";

import { formatLastLearnedAt, vitalityFromItem } from "./utils";
import type { AuthorIpItem } from "../../../lib/authorIp";

type Props = {
  item: AuthorIpItem;
  hint: string;
};

export default function AuthorIpDistillVitality({ item, hint }: Props) {
  const v = vitalityFromItem(item);
  const learnedAt = formatLastLearnedAt(v?.lastLearnedAt);
  const summary = v?.materialSummary;
  const top3 = v?.topContributors ?? [];
  const change = (v?.recentChange || "").trim();

  return (
    <div className="space-y-2 rounded-xl border border-line/70 bg-canvas/40 px-3 py-2">
      {hint ? <p className="text-xs text-brand">{hint}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        {learnedAt ? <span>上次学习 {learnedAt}</span> : <span>尚未学习</span>}
        {v?.learnMode ? <span>模式：{v.learnMode === "lite" ? "快速" : "深度"}</span> : null}
        {(v as { distillSource?: string })?.distillSource ? (
          <span>
            来源：
            {(v as { distillSource?: string }).distillSource === "llm"
              ? "AI"
              : (v as { distillSource?: string }).distillSource === "llm+heuristic"
                ? "AI+规则"
                : "规则"}
          </span>
        ) : null}
        {summary ? (
          <span>
            参与学习 {summary.learningCount ?? 0} 条（简历 {summary.experienceCount ?? 0} · 成稿{" "}
            {summary.articleCount ?? 0}）
          </span>
        ) : null}
      </div>
      {change ? (
        <p className="text-xs text-ink">
          <span className="font-medium text-muted">最近变像：</span>
          {change}
        </p>
      ) : null}
      {top3.length > 0 ? (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">贡献 Top3</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-ink">
            {top3.map((t) => (
              <li key={t} className="line-clamp-1" title={t}>
                {t}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
