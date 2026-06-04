"use client";

import type { ReactNode } from "react";
import type { ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

/** 输出区：任务确认、生成进度、稿件与改版等统一展示 */
export default function StudioAgentOutputCards({
  work,
  busy,
  isLoggedIn,
  activeVersion,
  reviseText,
  onReviseTextChange,
  onConfirmGenerate,
  onRevise,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  onMarkShipped,
  showFeatureNudge,
  onFillFeature,
  onDismissFeatureNudge
}: {
  work: StudioWork;
  busy: boolean;
  isLoggedIn: boolean;
  activeVersion: ManuscriptVersion | null;
  reviseText: string;
  onReviseTextChange: (v: string) => void;
  onConfirmGenerate?: () => void;
  onRevise?: () => void;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  onMarkShipped?: () => void;
  showFeatureNudge: boolean;
  onFillFeature: () => void;
  onDismissFeatureNudge: () => void;
}) {
  const plan = work.plan;
  const cards: ReactNode[] = [];
  const compareMode = Boolean(work.pendingPatch);
  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const showManuscript =
    manuscriptBlocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode);

  if (work.status === "planned" && plan && onConfirmGenerate) {
    cards.push(
      <OutputCard key="confirm-exec" title="确认执行">
        <p className="font-medium text-ink">{plan.goal}</p>
        {plan.outline.length ? (
          <ul className="mt-1.5 list-inside list-disc text-muted">
            {plan.outline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {plan.risks.length ? (
          <p className="mt-2 text-warning-ink">{plan.risks.join(" · ")}</p>
        ) : null}
        <p className="mt-2 text-muted">请确认以上任务后开始生成稿件。</p>
        <ActionRow>
          <PrimaryButton disabled={busy || !isLoggedIn} onClick={onConfirmGenerate}>
            确认执行
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

  if (showManuscript) {
    cards.push(
      <OutputCard
        key="manuscript"
        title={
          compareMode
            ? "改版预览"
            : activeVersion
              ? `稿件 · ${activeVersion.label}`
              : "稿件"
        }
      >
        <StudioOutputManuscript
          version={compareMode ? null : activeVersion}
          compareBlocks={compareMode ? work.pendingPatch?.proposedBlocks : undefined}
          compareMode={compareMode}
          selectedKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onToggleKey={onTogglePatchKey}
        />
      </OutputCard>
    );
  }

  if (work.pendingPatch && onApplyPatch && onDiscardPatch) {
    cards.push(
      <OutputCard key="patch" title="改版提议">
        <p className="text-ink">{work.pendingPatch.summary}</p>
        <p className="mt-1 text-muted">在上方勾选要采纳的块后确认。</p>
        <ActionRow>
          <PrimaryButton disabled={busy} onClick={() => onApplyPatch(true)}>
            采纳所选 ({selectedPatchKeys.size})
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
      <OutputCard key="ship" title="完成">
        <ActionRow>
          <GhostButton onClick={onMarkShipped}>标记已发布</GhostButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (showFeatureNudge) {
    cards.push(
      <OutputCard key="feature-nudge" title="我的特色">
        <p className="text-ink">这篇已经写好。要下一篇更像你自己，可以填「我的特色」。</p>
        <p className="mt-1 text-muted">
          填写路径：进入「对话」页 → 输入框下方点「我的特色」→ 保存后回到创作继续。
        </p>
        <ActionRow>
          <PrimaryButton onClick={onFillFeature}>去填写我的特色</PrimaryButton>
          <GhostButton onClick={onDismissFeatureNudge}>暂不</GhostButton>
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
