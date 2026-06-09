"use client";

import { useMemo, useState } from "react";
import { isStudioFirstDraftPatch } from "../../lib/studioPatchApply";
import { patchHunkLabel } from "../../lib/studioPatchHunkLabel";
import { shouldShowQualityNote } from "../../lib/studioEditorMode";
import { diffLines } from "../../lib/studioLineDiff";
import { studioSemanticPhase } from "../../lib/studioPhaseLabel";
import { STUDIO_HUNK_ADD, STUDIO_STATUS_PULSE, STUDIO_STATUS_TEXT } from "../../lib/studioVisualTokens";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  PendingPatch,
  StudioRun,
  StudioWork
} from "../../lib/studioWorkTypes";
import StudioErrorLine from "./StudioErrorLine";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioStreamingSurface from "./StudioStreamingSurface";

function PatchFooter({
  patch,
  work,
  busy,
  isFirstDraft,
  selectedCount,
  onApplyPartial,
  onApplyAll,
  onDiscard
}: {
  patch: PendingPatch;
  work: StudioWork;
  busy: boolean;
  isFirstDraft: boolean;
  selectedCount: number;
  onApplyPartial?: () => void;
  onApplyAll?: () => void;
  onDiscard?: () => void;
}) {
  const showQuality = shouldShowQualityNote(work.editorMode) && patch.qualityNote;
  const hunkCount = (patch.changedKeys ?? patch.selections ?? []).length;
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2">
      <p className="text-[12px] font-medium text-ink">
        {isFirstDraft ? "首稿 · 待确认" : `待确认 · ${hunkCount} 处改动`}
      </p>
      {patch.reason ? <p className="text-[10px] text-muted">{patch.reason}</p> : null}
      {showQuality ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">{patch.qualityNote}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {!isFirstDraft && onApplyPartial ? (
          <button
            type="button"
            disabled={busy || selectedCount <= 0}
            className="rounded-md bg-brand px-2.5 py-1 text-brand-foreground disabled:opacity-50"
            onClick={onApplyPartial}
          >
            采纳所选 ({selectedCount})
          </button>
        ) : null}
        {onApplyAll ? (
          <button
            type="button"
            disabled={busy}
            className={
              isFirstDraft
                ? "rounded-md bg-brand px-2.5 py-1 text-brand-foreground disabled:opacity-50"
                : "rounded-md border border-line px-2.5 py-1 hover:bg-fill disabled:opacity-50"
            }
            onClick={onApplyAll}
          >
            {isFirstDraft ? "采纳成稿" : "全部采纳"}
          </button>
        ) : null}
        {onDiscard ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1 hover:bg-fill disabled:opacity-50"
            onClick={onDiscard}
          >
            放弃
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LineDiffReview({
  before,
  after,
  selectedKeys,
  onToggleKey
}: {
  before: string;
  after: string;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
}) {
  const hunks = useMemo(() => diffLines(before, after, "body"), [before, after]);
  if (!hunks.length) return null;
  return (
    <div className="mb-2 space-y-1 text-[12px]">
      {hunks.map((h) => (
        <label
          key={h.key}
          className={[
            "flex cursor-pointer gap-2",
            selectedKeys.has(h.key) ? STUDIO_HUNK_ADD : "opacity-75"
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={selectedKeys.has(h.key)}
            onChange={() => onToggleKey(h.key)}
            className="mt-1"
          />
          <span className="min-w-0 flex-1">
            <span className="text-[10px] text-muted">{patchHunkLabel(h.key)}</span>
            {h.before ? (
              <span className="mt-0.5 block text-danger-ink line-through">{h.before}</span>
            ) : null}
            {h.after ? <span className="mt-0.5 block text-brand">{h.after}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function MinimalPatchBlocks({
  baseBlocks,
  proposedBlocks,
  changedKeys,
  patchSelections,
  isFirstDraft,
  onTogglePatchKey
}: {
  baseBlocks: ManuscriptBlock[];
  proposedBlocks: ManuscriptBlock[];
  changedKeys: Set<string>;
  patchSelections: Set<string>;
  isFirstDraft: boolean;
  onTogglePatchKey?: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (isFirstDraft) {
    return (
      <StudioOutputManuscript
        version={{
          id: "patch-full",
          label: "提议",
          createdAt: Date.now(),
          blocks: proposedBlocks
        }}
      />
    );
  }
  const baseBody = baseBlocks.find((b) => b.kind === "body")?.text ?? "";
  const proposedBody = proposedBlocks.find((b) => b.kind === "body")?.text ?? "";
  const bodyChanged = [...changedKeys].some((k) => k.startsWith("body:"));
  const titleChanged = changedKeys.has("title:0");

  if (expanded) {
    return (
      <>
        <button
          type="button"
          className="mb-2 text-[10px] text-muted underline"
          onClick={() => setExpanded(false)}
        >
          收起全文
        </button>
        <StudioOutputManuscript
          version={{
            id: "patch-full",
            label: "提议",
            createdAt: Date.now(),
            blocks: proposedBlocks
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-2">
      {titleChanged ? (
        <div className={STUDIO_HUNK_ADD}>
          <p className="text-[10px] text-muted">{patchHunkLabel("title:0")}</p>
          <p className="text-sm font-medium">{proposedBlocks.find((b) => b.kind === "title")?.text}</p>
        </div>
      ) : null}
      {bodyChanged && baseBody !== proposedBody ? (
        <LineDiffReview
          before={baseBody}
          after={proposedBody}
          selectedKeys={patchSelections}
          onToggleKey={(k) => onTogglePatchKey?.(k)}
        />
      ) : null}
      {[...changedKeys]
        .filter((k) => k.startsWith("meta:"))
        .map((key) => (
          <label key={key} className={`flex items-center gap-2 ${STUDIO_HUNK_ADD} text-[11px]`}>
            <input
              type="checkbox"
              checked={patchSelections.has(key)}
              onChange={() => onTogglePatchKey?.(key)}
            />
            {patchHunkLabel(key)}
          </label>
        ))}
      <button
        type="button"
        className="text-[10px] text-muted underline"
        onClick={() => setExpanded(true)}
      >
        查看全文
      </button>
    </div>
  );
}

export default function StudioTimelineManuscriptCard({
  work,
  run,
  version,
  baseVersion,
  busy,
  streamingBlocks = null,
  streamingBodyText = null,
  streamOptimizing = false,
  canvasRouteHint = "",
  pendingPatch = null,
  patchSelections = new Set<string>(),
  onApplyPatch,
  onDiscardPatch,
  onTogglePatchKey,
  onRetryError,
  selectionHighlight,
  onTextSelect
}: {
  work: StudioWork;
  run: StudioRun;
  version: ManuscriptVersion | null;
  baseVersion: ManuscriptVersion | null;
  isActiveVersion: boolean;
  busy: boolean;
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  streamOptimizing?: boolean;
  canvasRouteHint?: string;
  pendingPatch?: PendingPatch | null;
  patchSelections?: Set<string>;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  onTogglePatchKey?: (key: string) => void;
  onRetryError?: () => void;
  selectionHighlight?: string;
  onTextSelect?: (text: string) => void;
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const taskSentence = work.brief || "";

  if (isRunning) {
    const phase =
      canvasRouteHint ||
      studioSemanticPhase({
        runPhase: work.runPhase || run.summary,
        tool: run.tool === "revise" ? "revise" : "generate",
        streamingBlocks,
        searchingCorpus: /搜|资料/.test(work.runPhase || "")
      });
    const hasStream = Boolean(
      (streamingBlocks && streamingBlocks.length > 0) || streamingBodyText?.trim()
    );
    return (
      <div className="mt-2 space-y-2">
        <p className={`flex items-center gap-2 ${STUDIO_STATUS_TEXT}`}>
          <span className={STUDIO_STATUS_PULSE} aria-hidden />
          {phase}
          {streamOptimizing ? (
            <span className="text-[10px] text-muted">· 正在优化</span>
          ) : null}
        </p>
        {hasStream ? (
          <div className={streamOptimizing ? "opacity-90" : undefined}>
            <StudioStreamingSurface
            variant="active"
            blocks={streamingBlocks}
            bodyText={streamingBodyText}
            phase={phase}
            taskSentence={taskSentence}
            flowLayout
            isRevise={run.tool === "revise"}
            corpusNotebook={work.binding.notebook}
            corpusNoteIds={work.binding.noteIds}
          />
          </div>
        ) : (
          <div className="min-h-[3rem] rounded-md border border-dashed border-line/50" aria-hidden />
        )}
      </div>
    );
  }

  if (pendingPatch && pendingPatch.proposedBlocks.length > 0) {
    const isFirstDraft = isStudioFirstDraftPatch(work, pendingPatch);
    const changed = new Set(pendingPatch.changedKeys ?? pendingPatch.selections ?? []);
    return (
      <div className="mt-2">
        <PatchFooter
          patch={pendingPatch}
          work={work}
          busy={busy}
          isFirstDraft={isFirstDraft}
          selectedCount={patchSelections.size}
          onApplyPartial={
            isFirstDraft || !onApplyPatch ? undefined : () => onApplyPatch(true)
          }
          onApplyAll={onApplyPatch ? () => onApplyPatch(false) : undefined}
          onDiscard={onDiscardPatch}
        />
        <MinimalPatchBlocks
          baseBlocks={baseVersion?.blocks ?? []}
          proposedBlocks={pendingPatch.proposedBlocks}
          changedKeys={changed}
          patchSelections={patchSelections}
          isFirstDraft={isFirstDraft}
          onTogglePatchKey={isFirstDraft ? undefined : onTogglePatchKey}
        />
      </div>
    );
  }

  if (version && version.blocks.length > 0) {
    return (
      <div className="mt-2">
        <StudioOutputManuscript
          version={version}
          corpusNotebook={work.binding.notebook}
          corpusNoteIds={work.binding.noteIds}
          selectionHighlight={selectionHighlight}
          onTextSelect={onTextSelect}
        />
      </div>
    );
  }

  if (run.status === "error" && work.error) {
    return (
      <div className="mt-2">
        <StudioErrorLine message={work.error} onRetry={onRetryError} />
      </div>
    );
  }

  return null;
}
