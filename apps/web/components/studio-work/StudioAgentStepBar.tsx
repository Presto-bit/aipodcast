"use client";

import { useState } from "react";
import type { StudioAgentStep } from "../../lib/studioAgentSteps";
import { humanizeAgentStepLabel } from "../../lib/studioAgentReadable";

/** Cursor 式：可展开 step trace（label + reason） */
export default function StudioAgentStepBar({ steps }: { steps: StudioAgentStep[] }) {
  const visible = steps.filter((s) => s.status !== "pending");
  const [open, setOpen] = useState(true);
  if (!visible.length) return null;

  const running = visible.some((s) => s.status === "running");

  return (
    <div className="space-y-1" role="status" aria-label="Agent 步骤">
      <button
        type="button"
        className="text-[10px] text-muted hover:text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "收起" : "展开"}步骤 ({visible.length}){running ? " · 进行中" : ""}
      </button>
      {open
        ? visible.map((step) => (
            <div key={step.id} className="flex items-start gap-2 text-[11px] leading-snug text-muted/90">
              <StepDot status={step.status} />
              <div className="min-w-0">
                <span className={step.status === "done" ? "text-ink/80" : "text-muted"}>
                  {humanizeAgentStepLabel(step)}
                </span>
                {step.detail ? (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">{step.detail}</p>
                ) : null}
              </div>
            </div>
          ))
        : null}
    </div>
  );
}

function StepDot({ status }: { status: StudioAgentStep["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[9px] text-brand">
        ✓
      </span>
    );
  }
  if (status === "running") {
    return <span className="mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" />;
  }
  if (status === "error") {
    return <span className="mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />;
  }
  return <span className="mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-line" />;
}
