"use client";

import type { PlatformExpertId } from "../../../lib/homeComposerExpertTypes";
import { xhsFeatureNudgeHint } from "../../../lib/composerExpertFeatureNudge";

export default function ComposerFeatureNudgeBar({
  expertId,
  onFillFeature,
  onSkip
}: {
  expertId: PlatformExpertId;
  onFillFeature: () => void;
  onSkip: () => void;
}) {
  const xhsHint = xhsFeatureNudgeHint(expertId);

  return (
    <div className="mb-2 w-full rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 shadow-soft">
      <p className="text-sm font-medium text-ink">这篇要更像你，还是像通用模板？</p>
      {xhsHint ? <p className="mt-1 text-xs text-muted">{xhsHint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand/90"
          onClick={onFillFeature}
        >
          2 分钟填我的特色
        </button>
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-fill hover:text-ink"
          onClick={onSkip}
        >
          先试试通用的
        </button>
      </div>
    </div>
  );
}
