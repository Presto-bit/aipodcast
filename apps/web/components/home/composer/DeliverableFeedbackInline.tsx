"use client";

import { useEffect, useState } from "react";
import type { AssistantBlock } from "../../../lib/homeComposerExpertTypes";

type FeedbackBlock = Extract<AssistantBlock, { kind: "feedback" }>;

export default function DeliverableFeedbackInline({
  block,
  disabled,
  onPatch,
  onNotify
}: {
  block: FeedbackBlock;
  disabled?: boolean;
  onPatch: (patch: Partial<FeedbackBlock>) => void;
  onNotify: (message: string) => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const [popover, setPopover] = useState<string | null>(null);

  useEffect(() => {
    if (!popover) return;
    const timer = window.setTimeout(() => setPopover(null), 2400);
    return () => window.clearTimeout(timer);
  }, [popover]);

  const done = Boolean(block.submitted || block.selectedChip);

  function notify(msg: string) {
    setPopover(msg);
    onNotify(msg);
  }

  if (done) {
    const label =
      block.submitted === "positive"
        ? "👍 已反馈"
        : block.submitted === "negative"
          ? `👎 ${block.negativeReason ?? "已反馈"}`
          : block.selectedChip ?? "已记录";
    return (
      <span className="relative inline-flex items-center text-[11px] text-muted">
        {label}
        {popover ? (
          <span className="absolute bottom-full left-0 z-20 mb-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] text-canvas shadow-md">
            {popover}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted">反馈</span>
      <button
        type="button"
        disabled={disabled}
        className="rounded-md border border-line px-2 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
        onClick={() => {
          onPatch({ submitted: "positive" });
          notify("谢谢反馈");
        }}
      >
        👍
      </button>
      <button
        type="button"
        disabled={disabled}
        className="rounded-md border border-line px-2 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
        onClick={() => setShowReasons((v) => !v)}
      >
        👎
      </button>
      {block.chips.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          className="rounded-full border border-line/80 px-2 py-0.5 text-[10px] text-muted hover:border-brand/40 hover:text-ink disabled:opacity-50"
          onClick={() => {
            onPatch({ selectedChip: chip });
            notify(chip === "自定义" ? "请在输入框描述修改意见" : `已记录 · ${chip}`);
          }}
        >
          {chip}
        </button>
      ))}
      {popover ? (
        <span className="absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] text-canvas shadow-md">
          {popover}
        </span>
      ) : null}
      {showReasons && !disabled ? (
        <div className="flex w-full flex-wrap gap-1.5 pt-1">
          {["太 AI", "不像平台", "事实不对", "风格不对", "与我的资料不符"].map((reason) => (
            <button
              key={reason}
              type="button"
              className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted hover:text-ink"
              onClick={() => {
                onPatch({ submitted: "negative", negativeReason: reason });
                setShowReasons(false);
                notify(`已记录 · ${reason}`);
              }}
            >
              {reason}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
