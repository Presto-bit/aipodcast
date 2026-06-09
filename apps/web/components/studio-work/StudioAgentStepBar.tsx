"use client";

import type { StudioAgentStep } from "../../lib/studioAgentSteps";
import { humanizeAgentStepLabel } from "../../lib/studioAgentReadable";

/** Cursor 式：轻量 step 列表，挂在对话区状态插槽 */
export default function StudioAgentStepBar({ steps }: { steps: StudioAgentStep[] }) {
  const visible = steps.filter((s) => s.status !== "pending");
  if (!visible.length) return null;

  return (
    <div className="space-y-1" aria-label="进行中" role="status">
      {visible.map((step) => (
        <div key={step.id} className="flex items-center gap-2 text-[11px] leading-snug text-muted/90">
          <StepDot status={step.status} />
          <span className={step.status === "done" ? "text-ink/80" : "text-muted"}>
            {humanizeAgentStepLabel(step)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepDot({ status }: { status: StudioAgentStep["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[9px] text-brand">
        ✓
      </span>
    );
  }
  if (status === "running") {
    return <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" />;
  }
  if (status === "error") {
    return <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />;
  }
  return <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-line" />;
}
