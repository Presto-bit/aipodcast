"use client";

import type { ReactNode } from "react";
import type { StudioWork } from "../../lib/studioWorkTypes";
import { suggestBriefFromTurns } from "../../lib/studioAgentAsk";

/** Cursor 风格：确认、计划、进度、改版等均在输出区以卡片呈现 */
export default function StudioAgentOutputCards({
  work,
  busy,
  isLoggedIn,
  canPlan,
  reviseText,
  onReviseTextChange,
  onGeneratePlan,
  onConfirmGenerate,
  onRevise,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchCount,
  onMarkShipped
}: {
  work: StudioWork;
  busy: boolean;
  isLoggedIn: boolean;
  canPlan: boolean;
  reviseText: string;
  onReviseTextChange: (v: string) => void;
  onGeneratePlan?: () => void;
  onConfirmGenerate?: () => void;
  onRevise?: () => void;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchCount?: number;
  onMarkShipped?: () => void;
}) {
  const brief = work.brief.trim();
  const plan = work.plan;
  const cards: ReactNode[] = [];

  if (brief) {
    cards.push(
      <OutputCard key="brief" title="任务摘要">
        <p className="leading-relaxed text-ink">{brief}</p>
      </OutputCard>
    );
  }

  if (plan) {
    cards.push(
      <OutputCard key="plan" title="计划">
        <p className="font-medium text-ink">{plan.goal}</p>
        <ul className="mt-1.5 list-inside list-disc text-muted">
          {plan.outline.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {plan.risks.length ? (
          <p className="mt-2 text-warning-ink">{plan.risks.join(" · ")}</p>
        ) : null}
      </OutputCard>
    );
  }

  if ((work.status === "briefing" || work.status === "planned") && !plan && onGeneratePlan) {
    const draft = suggestBriefFromTurns(work, work.agentTurns ?? []);
    cards.push(
      <OutputCard key="plan-cta" title="下一步">
        <p className="text-muted">对话已足够时，可生成结构化计划。</p>
        {draft && !brief ? (
          <p className="mt-1 text-ink">{draft}</p>
        ) : null}
        <ActionRow>
          <PrimaryButton disabled={busy || !canPlan || !isLoggedIn} onClick={onGeneratePlan}>
            生成计划
          </PrimaryButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (work.status === "planned" && onConfirmGenerate) {
    cards.push(
      <OutputCard key="confirm-gen" title="确认生成">
        <p className="text-muted">请确认计划后再生成稿件（将产生可编辑版本）。</p>
        <ActionRow>
          <PrimaryButton disabled={busy || !isLoggedIn} onClick={onConfirmGenerate}>
            确认生成
          </PrimaryButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (work.status === "generating") {
    cards.push(
      <OutputCard key="gen" title="生成中">
        <p className="text-brand">{work.runPhase || "处理中…"}</p>
      </OutputCard>
    );
  }

  if (work.error) {
    cards.push(
      <OutputCard key="err" title="提示">
        <p className="text-danger-ink">{work.error}</p>
      </OutputCard>
    );
  }

  if (work.pendingPatch && onApplyPatch && onDiscardPatch) {
    cards.push(
      <OutputCard key="patch" title="改版提议">
        <p className="text-ink">{work.pendingPatch.summary}</p>
        <p className="mt-1 text-muted">在右侧稿件区勾选块后，在此确认采纳。</p>
        <ActionRow>
          <PrimaryButton disabled={busy} onClick={() => onApplyPatch(true)}>
            采纳所选 ({selectedPatchCount ?? 0})
          </PrimaryButton>
          <GhostButton disabled={busy} onClick={() => onApplyPatch(false)}>
            全部采纳
          </GhostButton>
          <GhostButton disabled={busy} onClick={onDiscardPatch}>
            放弃
          </GhostButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (work.status === "ready" && !work.pendingPatch && onRevise) {
    cards.push(
      <OutputCard key="revise" title="提交改版">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
            value={reviseText}
            onChange={(e) => onReviseTextChange(e.target.value)}
            placeholder="例如：标题更短更狠，正文别动"
            onKeyDown={(e) => e.key === "Enter" && !busy && onRevise()}
          />
          <PrimaryButton disabled={busy || !reviseText.trim()} onClick={onRevise}>
            提交
          </PrimaryButton>
        </div>
      </OutputCard>
    );
  }

  if (work.status === "ready" && onMarkShipped) {
    cards.push(
      <OutputCard key="ship" title="发布">
        <ActionRow>
          <GhostButton onClick={onMarkShipped}>标记已发布</GhostButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (!cards.length) return null;

  return <div className="space-y-2 py-2">{cards}</div>;
}

function OutputCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-fill/25 px-3 py-2.5 text-[13px]">
      <p className="text-[11px] font-medium text-muted">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ActionRow({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-2">{children}</div>;
}

function PrimaryButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  disabled,
  onClick
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-fill disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
