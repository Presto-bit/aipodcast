"use client";

import { useState } from "react";
import type { AssistantBlock, ExpertTaskDraft, PlatformExpertId } from "../../lib/homeComposerExpertTypes";
import { EXPERT_DISPLAY_NAMES } from "../../lib/composerExperts";
import {
  formatIntakeSelectionsForDisplay,
  isIntakeStepComplete,
  usesQuestionCardIntake
} from "../../lib/composerExpertIntake";
import DeliverableCard from "./composer/DeliverableCard";
import ConfirmEditForm from "./composer/ConfirmEditForm";
import QuestionCardPanel from "./composer/QuestionCardPanel";

type IntakeStepBlock = Extract<AssistantBlock, { kind: "intake_step" }>;
type ConfirmBlock = Extract<AssistantBlock, { kind: "confirm" }>;
type ClarificationBlock = Extract<AssistantBlock, { kind: "clarification" }>;
type ProgressBlock = Extract<AssistantBlock, { kind: "progress" }>;
type FeedbackBlock = Extract<AssistantBlock, { kind: "feedback" }>;

function ProgressPanel({ block, expertId }: { block: ProgressBlock; expertId: PlatformExpertId }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <p className="text-sm font-semibold text-ink">{EXPERT_DISPLAY_NAMES[expertId]} · 生成中</p>
      <ul className="mt-3 space-y-2">
        {block.steps.map((step, idx) => (
          <li key={`${step.label}-${idx}`} className="flex items-center gap-2 text-sm">
            <span
              className={[
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                step.status === "done"
                  ? "bg-brand text-brand-foreground"
                  : step.status === "active"
                    ? "border border-brand text-brand"
                    : "border border-line text-muted"
              ].join(" ")}
            >
              {step.status === "done" ? "✓" : step.status === "active" ? "…" : ""}
            </span>
            <span className={step.status === "active" ? "text-ink" : "text-muted"}>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntakeStepPanel({
  block,
  disabled,
  onChange,
  onNext,
  onConfirmDirect
}: {
  block: IntakeStepBlock;
  disabled?: boolean;
  onChange: (fieldId: string, value: string | string[], multi: boolean) => void;
  onNext: () => void;
  onConfirmDirect: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <p className="text-xs font-medium text-muted">
        第 {block.step}/{block.total} 步 · {block.theme}
      </p>
      <div className="mt-3 space-y-4">
        {block.fields.map((field) => {
          const selected = field.preselected ?? [];
          const hint = field.hint;
          return (
            <div key={field.fieldId}>
              <p className="text-sm font-medium text-ink">{field.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {field.options.map((opt) => {
                  const checked = selected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={[
                        "cursor-pointer rounded-full border px-3 py-1 text-xs transition",
                        checked ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:border-brand/40",
                        disabled ? "pointer-events-none opacity-60" : ""
                      ].join(" ")}
                    >
                      <input
                        type={field.multi ? "checkbox" : "radio"}
                        name={field.fieldId}
                        className="sr-only"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => {
                          if (field.multi) {
                            const next = checked ? selected.filter((x) => x !== opt.id) : [...selected, opt.id];
                            onChange(field.fieldId, next, true);
                          } else {
                            onChange(field.fieldId, opt.id, false);
                          }
                        }}
                      />
                      {opt.label}
                    </label>
                  );
                })}
              </div>
              {hint ? <p className="mt-2 text-xs text-brand">💡 {hint}</p> : null}
            </div>
          );
        })}
      </div>
      {!disabled ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill"
            onClick={onConfirmDirect}
          >
            按任务句直接确认
          </button>
          {block.step < block.total ? (
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
              onClick={onNext}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
              onClick={onConfirmDirect}
            >
              确认选项
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResolutionPanel({
  block,
  expertId,
  disabled,
  onStartGenerate,
  onConfirmUpdate,
  onExitChat,
  onEditFeature,
  onEditIntake
}: {
  block: ConfirmBlock;
  expertId: PlatformExpertId;
  disabled?: boolean;
  onStartGenerate: () => void;
  onConfirmUpdate: (taskSentence: string, intake: Record<string, string | string[]>) => void;
  onExitChat: () => void;
  onEditFeature: () => void;
  onEditIntake?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const mp = block.materialPlan;
  const inferenceLines =
    block.inferenceSummary?.length
      ? block.inferenceSummary
      : formatIntakeSelectionsForDisplay(expertId, block.intake as Record<string, string | string[]>);
  const isClarification = block.resolutionMode === "clarification";

  if (editing && !disabled) {
    return (
      <div className="rounded-2xl border border-brand/25 bg-surface p-4 shadow-soft">
        <ConfirmEditForm
          expertId={expertId}
          taskSentence={block.summary}
          intake={block.intake as Record<string, string | string[]>}
          onSave={(task, intake) => {
            onConfirmUpdate(task, intake);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-brand/25 bg-surface p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-ink">
          {isClarification ? "澄清需求" : "需求确认"} · {EXPERT_DISPLAY_NAMES[expertId]}
        </p>
        <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100">
          Resolution
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink">{block.summary}</p>

      {block.hint ? <p className="mt-2 text-xs text-brand">💡 {block.hint}</p> : null}

      {inferenceLines.length ? (
        <div className="mt-3 rounded-xl border border-line/80 bg-fill/20 p-3">
          <p className="text-xs font-medium text-muted">你已确认</p>
          <ul className="mt-2 space-y-1 text-xs text-ink">
            {inferenceLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {mp?.notebook ? (
        <div className="mt-4 rounded-xl border border-line/80 bg-fill/30 p-3 text-sm">
          <p className="font-medium text-ink">📎 资料计划</p>
          <p className="mt-1 text-muted">将检索：{mp.notebook} · 全部 {mp.noteCount} 篇</p>
          {mp.intendedUse ? <p className="mt-1 text-muted">预计用于：{mp.intendedUse}</p> : null}
        </div>
      ) : null}

      {block.featureStrip?.enabled && block.featureStrip.summary ? (
        <div className="mt-3 rounded-xl border border-line/80 bg-fill/20 p-3 text-sm">
          <p className="text-ink">🙋 本次会用你的特色：{block.featureStrip.summary}</p>
          {!disabled ? (
            <button type="button" className="mt-2 text-xs text-brand underline" onClick={onEditFeature}>
              编辑特色
            </button>
          ) : null}
        </div>
      ) : null}

      {block.toolchain.length ? (
        <p className="mt-3 text-xs text-muted">工具链：{block.toolchain.join(" · ")}</p>
      ) : null}

      {!disabled ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
            onClick={onStartGenerate}
          >
            确认并开始生成
          </button>
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={() => setEditing(true)}>
            编辑需求
          </button>
          {onEditIntake ? (
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onEditIntake}>
              改选项
            </button>
          ) : null}
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onExitChat}>
            这是聊天，不是开工
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ClarificationPanel({
  block,
  disabled,
  onStartTask,
  onContinueChat
}: {
  block: ClarificationBlock;
  disabled?: boolean;
  onStartTask: () => void;
  onContinueChat: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <p className="text-sm font-medium text-ink">需要确认一下</p>
      <p className="mt-2 text-sm text-muted">{block.message}</p>
      {!disabled ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
            onClick={onStartTask}
          >
            按任务开工
          </button>
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onContinueChat}>
            这只是聊天
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function ComposerExpertBlocks({
  blocks,
  expertId,
  archived,
  flowFrozen,
  draft,
  onIntakeChange,
  onIntakeNext,
  onIntakeSkip,
  onIntakeConfirmDirect,
  onConfirmStart,
  onConfirmUpdate,
  onExitChat,
  onEditFeature,
  onEditIntake,
  onClarifyStartTask,
  onClarifyContinueChat,
  onCopyToast,
  featureCoreComplete = 0,
  onFeedbackPatch,
  outputContextParts
}: {
  blocks: AssistantBlock[];
  expertId: PlatformExpertId;
  archived?: boolean;
  /** 任务流已离开该 turn（Resolution 等冻结，但不影响成品反馈） */
  flowFrozen?: boolean;
  draft?: ExpertTaskDraft;
  onIntakeChange: (fieldId: string, value: string | string[], multi: boolean) => void;
  onIntakeNext: () => void;
  onIntakeSkip?: () => void;
  onIntakeConfirmDirect: () => void;
  onConfirmStart: () => void;
  onConfirmUpdate: (taskSentence: string, intake: Record<string, string | string[]>) => void;
  onExitChat: () => void;
  onEditFeature: () => void;
  onEditIntake?: () => void;
  onClarifyStartTask?: () => void;
  onClarifyContinueChat?: () => void;
  onCopyToast?: (message: string) => void;
  featureCoreComplete?: number;
  onFeedbackPatch?: (patch: Partial<FeedbackBlock>) => void;
  outputContextParts?: string[];
}) {
  if (!blocks.length) return null;

  const panelsDisabled = archived || flowFrozen;

  const feedbackBlock = blocks.find((b): b is FeedbackBlock => b.kind === "feedback");
  const expertStrip = blocks.find((b) => b.kind === "expert_strip");
  const hasDeliverable = blocks.some((b) => b.kind === "deliverable");

  return (
    <div className="space-y-3">
      {expertStrip && !hasDeliverable ? (
        <p className="text-xs leading-relaxed text-muted">
          <span className="font-medium text-ink">{EXPERT_DISPLAY_NAMES[expertId]}</span>
          {" · "}
          {expertStrip.persona} · {expertStrip.methodology}
        </p>
      ) : null}
      {blocks.map((block, idx) => {
        if (block.kind === "expert_strip") {
          return null;
        }
        if (block.kind === "intake_step") {
          if (usesQuestionCardIntake(expertId)) {
            return (
              <QuestionCardPanel
                key={`intake-${block.step}`}
                block={block}
                expertId={expertId}
                disabled={panelsDisabled}
                intake={draft?.intake ?? {}}
                onChange={onIntakeChange}
                onComplete={onIntakeNext}
                onSkip={onIntakeSkip ?? onIntakeConfirmDirect}
              />
            );
          }
          return (
            <IntakeStepPanel
              key={`intake-${block.step}`}
              block={block}
              disabled={panelsDisabled}
              onChange={onIntakeChange}
              onNext={onIntakeNext}
              onConfirmDirect={onIntakeConfirmDirect}
            />
          );
        }
        if (block.kind === "confirm") {
          return (
            <ResolutionPanel
              key="confirm"
              block={block}
              expertId={expertId}
              disabled={panelsDisabled}
              onStartGenerate={onConfirmStart}
              onConfirmUpdate={onConfirmUpdate}
              onExitChat={onExitChat}
              onEditFeature={onEditFeature}
              onEditIntake={draft?.phase === "confirm" ? onEditIntake : undefined}
            />
          );
        }
        if (block.kind === "clarification") {
          return (
            <ClarificationPanel
              key="clarification"
              block={block}
              disabled={panelsDisabled}
              onStartTask={onClarifyStartTask ?? (() => {})}
              onContinueChat={onClarifyContinueChat ?? onExitChat}
            />
          );
        }
        if (block.kind === "progress") {
          return (
            <div key={`progress-${idx}`} className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-brand">Execution</p>
              <ProgressPanel block={block} expertId={expertId} />
            </div>
          );
        }
        if (block.kind === "deliverable") {
          return (
            <DeliverableCard
              key="deliverable"
              block={block}
              expertId={expertId}
              featureCoreComplete={featureCoreComplete}
              onCopyToast={onCopyToast}
              feedbackBlock={feedbackBlock}
              feedbackDisabled={archived || !onFeedbackPatch}
              onFeedbackPatch={onFeedbackPatch}
            />
          );
        }
        if (block.kind === "feedback") {
          return null;
        }
        return null;
      })}
    </div>
  );
}
