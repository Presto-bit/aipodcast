"use client";

import type { DeliverableMeta } from "../../../lib/homeComposerExpertTypes";

export default function DeliverableConsiderationPanel({ meta }: { meta: DeliverableMeta }) {
  const prov = meta.provenance;
  const hasContent =
    meta.rationale.length > 0 ||
    Boolean(meta.expectedEffect?.trim()) ||
    Boolean(meta.featureUsage?.applied);

  if (!hasContent) return null;

  return (
    <section className="rounded-xl border border-line/70 bg-fill/15 p-3 text-sm">
      <p className="text-xs font-semibold text-ink">创作说明</p>
      {meta.featureUsage?.applied ? (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-ink">特色运用：</span>
          {meta.featureUsage.summaryLine}
        </p>
      ) : null}
      {meta.rationale.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {meta.rationale.map((line) => (
            <li key={line} className="leading-relaxed">
              · {line}
            </li>
          ))}
        </ul>
      ) : null}
      {meta.expectedEffect ? (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-ink">预期效果：</span>
          {meta.expectedEffect}
        </p>
      ) : null}
      {prov.materialLabels?.length ? (
        <p className="mt-2 text-[11px] text-muted">资料：{prov.materialLabels.join("、")}</p>
      ) : null}
    </section>
  );
}
