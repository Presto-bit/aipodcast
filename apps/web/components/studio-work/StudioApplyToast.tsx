"use client";

import { STUDIO_STATUS_PULSE } from "../../lib/studioVisualTokens";

export default function StudioApplyToast({
  message,
  onUndo,
  onDismiss
}: {
  message: string;
  onUndo?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-line/60 bg-fill/40 px-2.5 py-1.5 text-[11px]">
      <span className="flex items-center gap-2 text-ink">
        <span className={STUDIO_STATUS_PULSE} aria-hidden />
        {message}
      </span>
      <div className="flex shrink-0 gap-2">
        {onUndo ? (
          <button type="button" className="text-brand hover:underline" onClick={onUndo}>
            撤销
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="text-muted hover:text-ink" onClick={onDismiss}>
            关闭
          </button>
        ) : null}
      </div>
    </div>
  );
}
