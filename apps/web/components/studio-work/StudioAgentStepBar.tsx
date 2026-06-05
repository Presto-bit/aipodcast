"use client";

import type { StudioAgentStep } from "../../lib/studioAgentSteps";

export default function StudioAgentStepBar({ steps }: { steps: StudioAgentStep[] }) {
  if (!steps.length) return null;

  return (
    <div
      className="mb-2 rounded-lg border border-line/50 bg-fill/20 px-2.5 py-2"
      aria-label="Agent 步骤"
    >
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">Agent</p>
      <ol className="space-y-1">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-[11px] leading-snug">
            <StepDot status={step.status} />
            <span className={step.status === "done" ? "text-ink" : "text-muted"}>{step.label}</span>
            {step.tool && step.tool !== step.label ? (
              <span className="text-[10px] text-muted/80">{step.tool}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepDot({ status }: { status: StudioAgentStep["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
        ✓
      </span>
    );
  }
  if (status === "running") {
    return <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand" />;
  }
  if (status === "error") {
    return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-danger" />;
  }
  return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-line" />;
}
