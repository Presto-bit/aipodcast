"use client";

import type { StudioWork } from "../../lib/studioWorkTypes";

/** 任务快照：仅在 Agent 线程顶部展示，无独立「任务说明」表单 */
export default function StudioAgentTaskPins({
  work,
  onGeneratePlan,
  onConfirmGenerate,
  busy,
  canPlan,
  canGenerate
}: {
  work: StudioWork;
  onGeneratePlan?: () => void;
  onConfirmGenerate?: () => void;
  busy?: boolean;
  canPlan?: boolean;
  canGenerate?: boolean;
}) {
  const brief = work.brief.trim();
  const plan = work.plan;
  const showPlanActions =
    (work.status === "briefing" || work.status === "planned") && (onGeneratePlan || onConfirmGenerate);

  if (!brief && !plan && !showPlanActions) return null;

  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-line/80 bg-fill/25 px-2.5 py-2 text-[11px]">
      {brief ? (
        <div>
          <p className="font-medium text-muted">当前任务（来自对话）</p>
          <p className="mt-0.5 leading-relaxed text-ink">{brief}</p>
        </div>
      ) : null}
      {plan ? (
        <div className={brief ? "border-t border-line/60 pt-1.5" : ""}>
          <p className="font-medium text-brand">计划</p>
          <p className="mt-0.5 text-ink">{plan.goal}</p>
          {plan.risks.length ? (
            <p className="mt-1 text-warning-ink">{plan.risks.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
      {showPlanActions ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {!plan && onGeneratePlan ? (
            <button
              type="button"
              disabled={busy || !canPlan}
              className="rounded border border-line px-2 py-0.5 hover:bg-fill disabled:opacity-50"
              onClick={onGeneratePlan}
            >
              生成计划
            </button>
          ) : null}
          {work.status === "planned" && onConfirmGenerate ? (
            <button
              type="button"
              disabled={busy || !canGenerate}
              className="rounded bg-brand px-2 py-0.5 text-brand-foreground disabled:opacity-50"
              onClick={onConfirmGenerate}
            >
              确认生成
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
