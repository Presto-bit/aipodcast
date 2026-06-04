"use client";

import type { ReactNode } from "react";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import { getComposerPrefsFeatureCore } from "../../lib/studioWorkStorage";
import type { ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

/** 输出区：解释在对话区；此处仅「须确认」与「产物」 */
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
  const actionCards: ReactNode[] = [];
  const artifactCards: ReactNode[] = [];
  const compareMode = Boolean(work.pendingPatch);
  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const showManuscript =
    manuscriptBlocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode);
  const styleReady = isFeatureCoreComplete(getComposerPrefsFeatureCore());

  if (work.status === "planned" && plan && onConfirmGenerate) {
    actionCards.push(
      <OutputCard key="confirm-exec" title="确认执行">
        <p className="font-medium text-ink">{plan.goal}</p>
        {plan.outline.length ? (
          <ul className="mt-1.5 list-inside list-disc text-muted">
            {plan.outline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <EvidenceSummary
          materialLabels={plan.materialLabels}
          materialCount={plan.materialCount}
          inferenceSummary={plan.inferenceSummary}
          voiceEnabled={plan.voiceEnabled}
          voiceSummary={plan.voiceSummary}
          styleReady={styleReady}
          risks={plan.risks}
        />
        <p className="mt-2 text-muted">请确认以上任务后开始生成稿件。</p>
        <ActionRow>
          <PrimaryButton disabled={busy || !isLoggedIn} onClick={onConfirmGenerate}>
            确认执行
          </PrimaryButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (work.error) {
    actionCards.push(
      <OutputCard key="err" title="提示">
        <p className="text-danger-ink">{work.error}</p>
      </OutputCard>
    );
  }

  if (work.pendingPatch && onApplyPatch && onDiscardPatch) {
    actionCards.push(
      <OutputCard key="patch" title="改版提议">
        <p className="text-ink">{work.pendingPatch.summary}</p>
        <p className="mt-1 text-muted">在下方产物区勾选要采纳的块后确认。</p>
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
    actionCards.push(
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
    actionCards.push(
      <OutputCard key="ship" title="完成">
        <ActionRow>
          <GhostButton onClick={onMarkShipped}>标记已发布</GhostButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (showFeatureNudge) {
    actionCards.push(
      <OutputCard key="feature-nudge" title="我的特色">
        <p className="text-ink">这篇已经写好。下一篇想更像你自己，可以补充「我的特色」。</p>
        <p className="mt-1 text-muted">
          填写路径：对话页 → 输入框下方「我的特色」→ 保存后回到创作（Rules 会自动生效）。
        </p>
        <ActionRow>
          <PrimaryButton onClick={onFillFeature}>去填写我的特色</PrimaryButton>
          <GhostButton onClick={onDismissFeatureNudge}>暂不</GhostButton>
        </ActionRow>
      </OutputCard>
    );
  }

  if (work.status === "generating") {
    artifactCards.push(
      <OutputCard key="gen" title="生成中">
        <p className="text-brand">{work.runPhase || "处理中…"}</p>
        <p className="mt-1 text-[10px] text-muted">
          {work.binding.noteIds.length
            ? `将结合 ${work.binding.noteIds.length} 篇资料生成，完成后显示在下方。`
            : "未绑资料时将结合通识生成，块标签可能为「补充」或「待核实」。"}
        </p>
      </OutputCard>
    );
  }

  if (showManuscript) {
    artifactCards.push(
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
        <p className="mb-2 text-[10px] text-muted">
          产物区 · 块角标：<span className="text-brand">资料</span> /{" "}
          <span className="text-warning-ink">待核实</span> / 补充
        </p>
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

  if (!actionCards.length && !artifactCards.length) return null;

  return (
    <div className="space-y-3 py-2">
      {actionCards.length ? (
        <section>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            须确认
          </p>
          <div className="space-y-2">{actionCards}</div>
        </section>
      ) : null}
      {artifactCards.length ? (
        <section>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            产物
          </p>
          <div className="space-y-2">{artifactCards}</div>
        </section>
      ) : null}
    </div>
  );
}

function EvidenceSummary({
  materialLabels,
  materialCount,
  inferenceSummary,
  voiceEnabled,
  voiceSummary,
  styleReady,
  risks
}: {
  materialLabels: string[];
  materialCount: number;
  inferenceSummary: string[];
  voiceEnabled: boolean;
  voiceSummary: string;
  styleReady: boolean;
  risks: string[];
}) {
  return (
    <div className="mt-2 space-y-1 rounded-md border border-line/60 bg-surface/50 px-2 py-1.5 text-[10px] text-muted">
      <p>
        <span className="font-medium text-ink">依据：</span>
        {materialCount > 0
          ? materialLabels.join(" · ") || `${materialCount} 篇资料`
          : "未绑资料（通识兜底）"}
      </p>
      {inferenceSummary.length ? (
        <p>
          <span className="font-medium text-ink">推断：</span>
          {inferenceSummary.join(" · ")}
        </p>
      ) : null}
      <p>
        <span className="font-medium text-ink">风格 Rules：</span>
        {styleReady || voiceEnabled
          ? voiceSummary || "已启用我的特色"
          : "未填完整 · 成稿后可去对话页补充"}
      </p>
      {risks.length ? <p className="text-warning-ink">{risks.join(" · ")}</p> : null}
    </div>
  );
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
