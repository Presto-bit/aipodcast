"use client";

import type { ReactNode } from "react";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import { getComposerPrefsFeatureCore } from "../../lib/studioWorkStorage";
import type { ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

function outputHeading(work: StudioWork, activeVersion: ManuscriptVersion | null, compareMode: boolean): string | null {
  if (compareMode) return "改版预览";
  if (work.status === "generating") return "生成中";
  if (work.status === "planned" && work.plan) return "计划";
  if (
    activeVersion &&
    (work.status === "ready" || work.status === "shipped" || work.pendingPatch)
  ) {
    return `稿件 · ${activeVersion.label}`;
  }
  return null;
}

/** 输出区：单标题 + 扁平产物；须确认类提示在文末 */
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
  const compareMode = Boolean(work.pendingPatch);
  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const showManuscript =
    manuscriptBlocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode);
  const styleReady = isFeatureCoreComplete(getComposerPrefsFeatureCore());
  const heading = outputHeading(work, activeVersion, compareMode);

  const body: ReactNode[] = [];
  const footnotes: ReactNode[] = [];

  if (work.error) {
    body.push(
      <p key="err" className="text-[13px] text-danger-ink">
        {work.error}
      </p>
    );
  }

  if (work.status === "generating") {
    body.push(
      <p key="gen" className="text-[13px] text-brand">
        {work.runPhase || "处理中…"}
      </p>
    );
    if (work.binding.noteIds.length) {
      body.push(
        <p key="gen-hint" className="text-[11px] text-muted">
          结合 {work.binding.noteIds.length} 篇资料生成，完成后显示在下方。
        </p>
      );
    }
  }

  if (work.status === "planned" && plan) {
    body.push(
      <div key="plan" className="space-y-2 text-[13px]">
        <p className="font-medium text-ink">{plan.goal}</p>
        {plan.outline.length ? (
          <ul className="list-inside list-disc text-muted">
            {plan.outline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <PlanMeta plan={plan} styleReady={styleReady} />
      </div>
    );
    footnotes.push(
      <p key="confirm-plan" className="text-[11px] text-muted">
        计划已就绪。回复「确认」或「确认执行」开始生成
        {onConfirmGenerate ? (
          <>
            {" "}
            ·{" "}
            <button
              type="button"
              disabled={busy || !isLoggedIn}
              className="text-brand underline disabled:opacity-50"
              onClick={onConfirmGenerate}
            >
              点此执行
            </button>
          </>
        ) : null}
      </p>
    );
  }

  if (work.pendingPatch && onApplyPatch && onDiscardPatch) {
    body.push(
      <p key="patch-sum" className="text-[13px] text-ink">
        {work.pendingPatch.summary} — 勾选下方变更块后采纳。
      </p>
    );
    footnotes.push(
      <div key="patch-actions" className="flex flex-wrap gap-2 text-[11px]">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-brand px-2 py-1 text-brand-foreground disabled:opacity-50"
          onClick={() => onApplyPatch(true)}
        >
          采纳所选 ({selectedPatchKeys.size})
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-line px-2 py-1 hover:bg-fill disabled:opacity-50"
          onClick={() => onApplyPatch(false)}
        >
          全部采纳
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-line px-2 py-1 hover:bg-fill disabled:opacity-50"
          onClick={onDiscardPatch}
        >
          放弃
        </button>
      </div>
    );
  }

  if (showManuscript) {
    body.push(
      <StudioOutputManuscript
        key="ms"
        version={compareMode ? null : activeVersion}
        compareBlocks={compareMode ? work.pendingPatch?.proposedBlocks : undefined}
        compareMode={compareMode}
        selectedKeys={selectedPatchKeys}
        changedKeys={changedKeys}
        onToggleKey={onTogglePatchKey}
      />
    );
  }

  if (work.status === "ready" && !work.pendingPatch && onRevise) {
    footnotes.push(
      <div key="revise" className="flex gap-2 text-[12px]">
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-ink"
          value={reviseText}
          onChange={(e) => onReviseTextChange(e.target.value)}
          placeholder="改版意见，如：标题更短更狠，正文别动"
          onKeyDown={(e) => e.key === "Enter" && !busy && onRevise()}
        />
        <button
          type="button"
          disabled={busy || !reviseText.trim()}
          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground disabled:opacity-50"
          onClick={onRevise}
        >
          提交改版
        </button>
      </div>
    );
  }

  if (work.status === "ready" && onMarkShipped) {
    footnotes.push(
      <p key="ship" className="text-[11px] text-muted">
        <button type="button" className="text-brand underline" onClick={onMarkShipped}>
          标记已发布
        </button>
      </p>
    );
  }

  if (showFeatureNudge) {
    footnotes.push(
      <p key="feature" className="text-[11px] text-muted">
        成稿完成。下一篇想更像自己，可去对话页填写「我的特色」。
        <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
          去填写
        </button>
        <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
          暂不
        </button>
      </p>
    );
  }

  const orchestratorLine = work.lastOrchestratorNote?.trim();
  if (orchestratorLine && work.status !== "planned") {
    footnotes.push(
      <p key="orch" className="text-[10px] text-muted/80">
        {orchestratorLine}
      </p>
    );
  }

  if (!heading && !body.length && !footnotes.length) return null;

  return (
    <div className="space-y-2 py-2">
      {heading ? (
        <p className="text-xs font-medium text-ink">{heading}</p>
      ) : null}
      {body.length ? <div className="space-y-2">{body}</div> : null}
      {footnotes.length ? (
        <div className="space-y-2 border-t border-line/50 pt-2">{footnotes}</div>
      ) : null}
    </div>
  );
}

function PlanMeta({
  plan,
  styleReady
}: {
  plan: NonNullable<StudioWork["plan"]>;
  styleReady: boolean;
}) {
  const bits: string[] = [];
  if (plan.materialCount > 0) {
    bits.push(`资料 ${plan.materialLabels.join(" · ") || `${plan.materialCount} 篇`}`);
  } else {
    bits.push("未绑资料");
  }
  if (plan.inferenceSummary.length) bits.push(plan.inferenceSummary.join(" · "));
  bits.push(styleReady || plan.voiceEnabled ? plan.voiceSummary || "已启用我的特色" : "我的特色未填完整");
  if (plan.risks.length) bits.push(plan.risks.join(" · "));

  return <p className="text-[11px] text-muted">{bits.join(" · ")}</p>;
}
