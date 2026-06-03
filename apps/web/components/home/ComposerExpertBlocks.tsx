"use client";

import type { AssistantBlock, ExpertTaskDraft, PlatformExpertId } from "../../lib/homeComposerExpertTypes";
import { EXPERT_DISPLAY_NAMES } from "../../lib/composerExperts";
import { formatIntakeSelectionsForDisplay } from "../../lib/composerExpertIntake";
import DeliverableCard from "./composer/DeliverableCard";

type IntakeStepBlock = Extract<AssistantBlock, { kind: "intake_step" }>;
type ConfirmBlock = Extract<AssistantBlock, { kind: "confirm" }>;
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

function ConfirmPanel({
  block,
  expertId,
  disabled,
  onStartGenerate,
  onEditIntake,
  onExitChat,
  onEditFeature
}: {
  block: ConfirmBlock;
  expertId: PlatformExpertId;
  disabled?: boolean;
  onStartGenerate: () => void;
  onEditIntake: () => void;
  onExitChat: () => void;
  onEditFeature: () => void;
}) {
  const mp = block.materialPlan;
  const intakeLines = formatIntakeSelectionsForDisplay(expertId, block.intake as Record<string, string | string[]>);

  return (
    <div className="rounded-2xl border border-brand/25 bg-surface p-4 shadow-soft">
      <p className="text-sm font-semibold text-ink">确认 · {EXPERT_DISPLAY_NAMES[expertId]}</p>
      <p className="mt-2 text-sm text-ink">{block.summary}</p>

      {intakeLines.length ? (
        <ul className="mt-3 space-y-1 rounded-xl border border-line/80 bg-fill/20 p-3 text-xs text-muted">
          {intakeLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
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
            开始生成
          </button>
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onEditIntake}>
            改一项
          </button>
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onExitChat}>
            改聊一下
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
  draft,
  onIntakeChange,
  onIntakeNext,
  onIntakeConfirmDirect,
  onConfirmStart,
  onConfirmEditIntake,
  onExitChat,
  onEditFeature,
  onCopyToast,
  featureCoreComplete = 0,
  onFeedbackPatch,
  outputContextParts
}: {
  blocks: AssistantBlock[];
  expertId: PlatformExpertId;
  archived?: boolean;
  draft?: ExpertTaskDraft;
  onIntakeChange: (fieldId: string, value: string | string[], multi: boolean) => void;
  onIntakeNext: () => void;
  onIntakeConfirmDirect: () => void;
  onConfirmStart: () => void;
  onConfirmEditIntake: () => void;
  onExitChat: () => void;
  onEditFeature: () => void;
  onCopyToast?: (message: string) => void;
  featureCoreComplete?: number;
  onFeedbackPatch?: (patch: Partial<FeedbackBlock>) => void;
  outputContextParts?: string[];
}) {
  if (!blocks.length) return null;

  const feedbackBlock = blocks.find((b): b is FeedbackBlock => b.kind === "feedback");

  return (
    <div className="space-y-3">
      {archived ? (
        <p className="text-xs text-muted">已退出专家任务 · 上方选项仅供回顾</p>
      ) : null}
      {blocks.map((block, idx) => {
        if (block.kind === "expert_strip") {
          return (
            <div key={`strip-${idx}`} className="rounded-xl border border-line/70 bg-fill/20 px-3 py-2">
              {outputContextParts?.length ? (
                <p className="text-xs font-medium text-ink">{outputContextParts.join(" · ")}</p>
              ) : (
                <p className="text-xs font-medium text-ink">{EXPERT_DISPLAY_NAMES[expertId]}</p>
              )}
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                {block.persona} · {block.methodology}
              </p>
            </div>
          );
        }
        if (block.kind === "intake_step") {
          return (
            <IntakeStepPanel
              key={`intake-${block.step}`}
              block={block}
              disabled={archived}
              onChange={onIntakeChange}
              onNext={onIntakeNext}
              onConfirmDirect={onIntakeConfirmDirect}
            />
          );
        }
        if (block.kind === "confirm") {
          return (
            <ConfirmPanel
              key="confirm"
              block={block}
              expertId={expertId}
              disabled={archived}
              onStartGenerate={onConfirmStart}
              onEditIntake={onConfirmEditIntake}
              onExitChat={onExitChat}
              onEditFeature={onEditFeature}
            />
          );
        }
        if (block.kind === "progress") {
          return <ProgressPanel key={`progress-${idx}`} block={block} expertId={expertId} />;
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
