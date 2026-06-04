"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import type { ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <span className="text-muted">…</span> }
);

function outputHeading(work: StudioWork, compareMode: boolean): string | null {
  if (compareMode) return "改版预览";
  if (work.status === "generating") return "生成中";
  if (work.status === "planned" && work.plan) return "计划";
  if (
    work.versions.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || work.pendingPatch)
  ) {
    return "稿件";
  }
  return null;
}

/** 输出区：单标题 + 稿件一体展示；成稿附言在稿件后 */
export default function StudioAgentOutputCards({
  work,
  busy,
  activeVersion,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  showFeatureNudge,
  onFillFeature,
  onDismissFeatureNudge
}: {
  work: StudioWork;
  busy: boolean;
  activeVersion: ManuscriptVersion | null;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
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
  const coachText = work.postDoneCoach?.trim();
  const showCoach = Boolean(coachText || work.postDoneCoachStreaming);
  const heading = outputHeading(work, compareMode);

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
  }

  if (work.status === "planned" && plan && !busy) {
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

  if (showCoach) {
    body.push(
      <div key="coach" className="text-[13px] leading-relaxed text-ink/90">
        {coachText ? (
          <NotesAskAnswerMarkdownBody text={coachText} />
        ) : (
          <span className="inline-block h-3 w-12 animate-pulse rounded bg-fill" aria-hidden />
        )}
      </div>
    );
  }

  if (work.pendingPatch && onApplyPatch && onDiscardPatch) {
    footnotes.push(
      <div key="patch-actions" className="flex flex-wrap gap-2 text-[11px]">
        <span className="text-muted">{work.pendingPatch.summary}</span>
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

  if (showFeatureNudge) {
    footnotes.push(
      <p key="feature" className="text-[11px] text-muted">
        下一篇想更像自己，可去对话页填写「我的特色」。
        <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
          去填写
        </button>
        <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
          暂不
        </button>
      </p>
    );
  }

  if (!heading && !body.length && !footnotes.length) return null;

  return (
    <div className="space-y-2 py-2">
      {heading ? <p className="text-xs font-medium text-ink">{heading}</p> : null}
      {body.length ? <div className="space-y-3">{body}</div> : null}
      {footnotes.length ? (
        <div className="space-y-2 border-t border-line/50 pt-2">{footnotes}</div>
      ) : null}
    </div>
  );
}
