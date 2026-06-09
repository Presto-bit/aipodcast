"use client";

import { STUDIO_ERROR_LINE } from "../../lib/studioVisualTokens";

export default function StudioErrorLine({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className={STUDIO_ERROR_LINE}>
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="shrink-0 text-brand hover:underline" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
