"use client";

import { useState } from "react";
import { evidencePartsFromWork } from "../../lib/studioEvidenceBar";
import { STUDIO_EVIDENCE_BAR, STUDIO_MUTED_TEXT } from "../../lib/studioVisualTokens";
import type { StudioWork } from "../../lib/studioWorkTypes";

export default function StudioTrustBar({
  work,
  taskSummary,
  onDomainClick,
  onCorpusClick
}: {
  work: StudioWork;
  taskSummary?: string;
  onDomainClick?: () => void;
  onCorpusClick?: () => void;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const parts = evidencePartsFromWork(work, taskSummary);

  return (
    <div className="mb-2 space-y-1">
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${STUDIO_EVIDENCE_BAR}`}>
        <button
          type="button"
          className="text-brand hover:underline"
          title="写作领域（点击可改）"
          onClick={() => {
            onDomainClick?.();
            setDetail(`推断：${parts.domainFormat}${parts.plannerReason ? ` · ${parts.plannerReason}` : ""}`);
          }}
        >
          {parts.domainFormat}
        </button>
        <span className="text-muted/50">·</span>
        <button
          type="button"
          className={parts.corpusCount > 0 ? "text-brand hover:underline" : "text-muted"}
          title="参考资料"
          onClick={() => {
            onCorpusClick?.();
            setDetail(
              parts.corpusCount > 0
                ? `已绑定 ${parts.corpusCount} 篇资料，写稿时将优先检索`
                : "未绑资料；可在输入框旁添加笔记本"
            );
          }}
        >
          {parts.corpusLabel}
        </button>
        {parts.taskSummary ? (
          <>
            <span className="text-muted/50">·</span>
            <span className="truncate max-w-[12rem]">{parts.taskSummary.slice(0, 40)}</span>
          </>
        ) : null}
      </div>
      {detail ? <p className={STUDIO_MUTED_TEXT}>{detail}</p> : null}
    </div>
  );
}
