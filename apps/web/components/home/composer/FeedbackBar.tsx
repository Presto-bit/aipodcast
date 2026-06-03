"use client";

import { useState } from "react";
import type { AssistantBlock } from "../../../lib/homeComposerExpertTypes";

type FeedbackBlock = Extract<AssistantBlock, { kind: "feedback" }>;

const NEGATIVE_REASONS = ["太 AI", "不像平台", "事实不对", "风格不对", "与我的资料不符"] as const;

export default function FeedbackBar({
  block,
  disabled,
  onPositive,
  onNegative,
  onChip,
  onCustom
}: {
  block: FeedbackBlock;
  disabled?: boolean;
  onPositive: () => void;
  onNegative: (reason: string) => void;
  onChip: (chip: string) => void;
  onCustom: () => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const submitted = block.submitted;
  const recordedChip = block.selectedChip;

  if (submitted || recordedChip) {
    const label =
      submitted === "positive"
        ? "👍 已反馈 · 谢谢"
        : submitted === "negative" && block.negativeReason
          ? `👎 已反馈 · ${block.negativeReason}`
          : recordedChip
            ? `已记录 · ${recordedChip}`
            : "已反馈";
    return (
      <div className="rounded-xl border border-line/60 bg-fill/20 px-4 py-3 text-sm text-muted">{label}</div>
    );
  }

  return (
    <div className="rounded-xl border border-line/70 bg-fill/10 px-4 py-3">
      <p className="text-xs font-medium text-muted">这次结果</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill disabled:opacity-50"
          onClick={onPositive}
        >
          👍 好用
        </button>
        <button
          type="button"
          disabled={disabled}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill disabled:opacity-50"
          onClick={() => setShowReasons((v) => !v)}
        >
          👎 不对味
        </button>
      </div>

      {showReasons && !disabled ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {NEGATIVE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-brand/40 hover:text-ink"
              onClick={() => onNegative(reason)}
            >
              {reason}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {block.chips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={disabled}
            className="rounded-full border border-line/80 bg-surface px-3 py-1 text-xs text-ink hover:border-brand/40 disabled:opacity-50"
            onClick={() => onChip(chip)}
          >
            {chip}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:text-ink disabled:opacity-50"
          onClick={onCustom}
        >
          自定义…
        </button>
      </div>
    </div>
  );
}
