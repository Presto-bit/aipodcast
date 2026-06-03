"use client";

import type { CreationIntent } from "../../../lib/composerUtteranceClassify";
import { EXPERT_DISPLAY_NAMES } from "../../../lib/composerExperts";

export default function ComposerIntentSuggestBar({
  intent,
  onSwitchExpert,
  onContinueChat
}: {
  intent: CreationIntent;
  onSwitchExpert: () => void;
  onContinueChat: () => void;
}) {
  const label = EXPERT_DISPLAY_NAMES[intent.expertId];
  return (
    <div className="mb-2 w-full rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 shadow-soft">
      <p className="text-sm text-ink">
        {intent.message} ·{" "}
        <span className="text-muted">需要交付物时可切换专家开工</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand/90"
          onClick={onSwitchExpert}
        >
          换{label}
        </button>
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-fill hover:text-ink"
          onClick={onContinueChat}
        >
          继续聊天
        </button>
      </div>
    </div>
  );
}
