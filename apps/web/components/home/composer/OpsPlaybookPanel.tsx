"use client";

import { useMemo, useState } from "react";
import type { OpsPlaybook, OpsPlaybookStep } from "../../../lib/homeComposerExpertTypes";
import { opsStepCopyText, opsTierSummary } from "../../../lib/homeComposerExpertJob";

async function copyText(text: string, onCopyToast?: (msg: string) => void, okMsg = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    onCopyToast?.(okMsg);
  } catch {
    onCopyToast?.("复制失败");
  }
}

function CopySticker({
  label,
  text,
  onCopyToast
}: {
  label: string;
  text: string;
  onCopyToast?: (msg: string) => void;
}) {
  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 p-3 dark:border-amber-900/50 dark:bg-amber-950/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-100">{label}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{text}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-amber-300/80 px-2 py-1 text-[11px] text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/50"
          onClick={() => void copyText(text, onCopyToast, `已复制 · ${label}`)}
        >
          复制
        </button>
      </div>
    </div>
  );
}

function OpsStepRow({
  step,
  expanded,
  checked,
  onToggleExpand,
  onToggleCheck,
  onCopyToast
}: {
  step: OpsPlaybookStep;
  expanded: boolean;
  checked: boolean;
  onToggleExpand: () => void;
  onToggleCheck: () => void;
  onCopyToast?: (msg: string) => void;
}) {
  const tierBorder =
    step.tier === "must_do"
      ? "border-l-brand"
      : step.tier === "after_publish"
        ? "border-l-zinc-300 dark:border-l-zinc-600"
        : "border-l-line";

  return (
    <div className={`rounded-xl border border-line/70 border-l-4 ${tierBorder} bg-surface`}>
      <div className="flex items-start gap-2 p-3">
        {step.tier === "must_do" ? (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-brand"
            checked={checked}
            onChange={onToggleCheck}
            aria-label={`标记完成：${step.title}`}
          />
        ) : (
          <span className="mt-0.5 inline-block w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          <p className="text-sm font-medium text-ink">
            {expanded ? "▾" : "▸"} {step.stepNo}. {step.title}
          </p>
          {!expanded && step.collapsedSummary ? (
            <p className="mt-0.5 text-xs text-muted">{step.collapsedSummary}</p>
          ) : null}
          {!expanded && !step.collapsedSummary ? (
            <p className="mt-0.5 text-xs text-muted line-clamp-1">{step.objective}</p>
          ) : null}
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-[11px] text-brand hover:bg-brand/10"
          onClick={() => void copyText(opsStepCopyText(step), onCopyToast, "已复制本步")}
        >
          复制本步
        </button>
      </div>
      {expanded ? (
        <div className="space-y-3 border-t border-line/50 px-3 pb-3 pt-2">
          <p className="text-xs text-muted">{step.objective}</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-ink">
            {step.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          {step.copyBlocks?.map((block) => (
            <CopySticker key={block.label} label={block.label} text={block.text} onCopyToast={onCopyToast} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function OpsPlaybookPanel({
  ops,
  onCopyToast
}: {
  ops: OpsPlaybook;
  onCopyToast?: (msg: string) => void;
}) {
  const summary = useMemo(() => opsTierSummary(ops.steps), [ops.steps]);
  const initialExpanded = useMemo(
    () => new Set(ops.steps.filter((s) => s.defaultExpanded).map((s) => s.stepNo)),
    [ops.steps]
  );
  const [expanded, setExpanded] = useState<Set<number>>(initialExpanded);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const mustDoSteps = ops.steps.filter((s) => s.tier === "must_do");
  const mainSteps = ops.steps.filter((s) => s.tier !== "after_publish");
  const afterSteps = ops.steps.filter((s) => s.tier === "after_publish");

  const checkedMust = mustDoSteps.filter((s) => checked.has(s.stepNo)).length;

  function toggleExpand(stepNo: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(stepNo)) next.delete(stepNo);
      else next.add(stepNo);
      return next;
    });
  }

  function toggleCheck(stepNo: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(stepNo)) next.delete(stepNo);
      else next.add(stepNo);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>
          必做 {summary.mustDo} 步 · 可稍后 {summary.niceToHave} 步 · 发布后再看 {summary.afterPublish} 步
        </p>
        {summary.mustDo > 0 ? (
          <p className="font-medium text-ink">
            已完成 {checkedMust}/{summary.mustDo}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {mainSteps.map((step) => (
          <OpsStepRow
            key={step.stepNo}
            step={step}
            expanded={expanded.has(step.stepNo)}
            checked={checked.has(step.stepNo)}
            onToggleExpand={() => toggleExpand(step.stepNo)}
            onToggleCheck={() => toggleCheck(step.stepNo)}
            onCopyToast={onCopyToast}
          />
        ))}
      </div>

      {afterSteps.length ? (
        <div className="space-y-2 rounded-xl bg-fill/40 p-3">
          <p className="text-xs font-medium text-muted">发布后再看</p>
          {afterSteps.map((step) => (
            <OpsStepRow
              key={step.stepNo}
              step={step}
              expanded={expanded.has(step.stepNo)}
              checked={checked.has(step.stepNo)}
              onToggleExpand={() => toggleExpand(step.stepNo)}
              onToggleCheck={() => toggleCheck(step.stepNo)}
              onCopyToast={onCopyToast}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
