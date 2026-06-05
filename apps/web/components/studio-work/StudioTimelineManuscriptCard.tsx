"use client";

import { diffBlockKeys } from "../../lib/studioDeliverable";
import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  PendingPatch,
  StudioRun,
  StudioWork
} from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioStreamingSurface from "./StudioStreamingSurface";

export default function StudioTimelineManuscriptCard({
  work,
  run,
  version,
  pendingPatch,
  baseVersion,
  isActiveVersion,
  busy,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  onApplyPatch,
  onDiscardPatch,
  onTitleIndexChange,
  onWowRevise,
  onBlocksChange,
  onSelectionRevise,
  streamingBlocks = null,
  streamingBodyText = null
}: {
  work: StudioWork;
  run: StudioRun;
  version: ManuscriptVersion | null;
  pendingPatch: PendingPatch | null;
  baseVersion: ManuscriptVersion | null;
  isActiveVersion: boolean;
  busy: boolean;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  onTitleIndexChange?: (index: number) => void;
  onWowRevise?: (opinion: string) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onSelectionRevise?: (selectedText: string, opinion: string) => void;
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const compareMode = Boolean(pendingPatch);
  const taskSentence = taskSentenceFromWork(work);

  const displayBlocks =
    compareMode && pendingPatch
      ? pendingPatch.proposedBlocks
      : version?.blocks ?? [];

  const patchChangedKeys =
    compareMode && pendingPatch && baseVersion
      ? diffBlockKeys(baseVersion.blocks, pendingPatch.proposedBlocks)
      : changedKeys;

  const editable =
    isActiveVersion &&
    work.status === "ready" &&
    !compareMode &&
    !isRunning &&
    !busy &&
    Boolean(onBlocksChange && version);

  if (isRunning && !compareMode) {
    const phase = work.runPhase || run.summary || (run.tool === "revise" ? "改版中…" : "写稿中…");
    const hasStream = Boolean(
      (streamingBlocks && streamingBlocks.length > 0) || streamingBodyText?.trim()
    );
    if (hasStream) {
      return (
        <div className="mt-2">
          <StudioStreamingSurface
            variant="active"
            blocks={streamingBlocks}
            bodyText={streamingBodyText}
            phase={phase}
            taskSentence={taskSentence}
            flowLayout
          />
        </div>
      );
    }
    return (
      <div className="mt-2">
        <StudioOutputManuscript
          version={run.tool === "revise" ? baseVersion : null}
          generatingPhase={phase}
          generatingTask={taskSentence}
        />
      </div>
    );
  }

  if (compareMode && pendingPatch) {
    return (
      <div className="mt-2 space-y-2">
        <StudioOutputManuscript
          version={null}
          compareBlocks={pendingPatch.proposedBlocks}
          compareMode
          selectedKeys={selectedPatchKeys}
          changedKeys={patchChangedKeys}
          onToggleKey={onTogglePatchKey}
        />
        {onApplyPatch && onDiscardPatch ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted">{pendingPatch.summary}</span>
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
        ) : null}
      </div>
    );
  }

  if (version && displayBlocks.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        <StudioOutputManuscript
          version={version}
          borderless
          onTitleIndexChange={isActiveVersion ? onTitleIndexChange : undefined}
          onWowRevise={isActiveVersion && work.status === "ready" ? onWowRevise : undefined}
          wowReviseBusy={busy}
          editable={editable}
          onBlocksChange={editable ? onBlocksChange : undefined}
          onSelectionRevise={isActiveVersion ? onSelectionRevise : undefined}
        />
      </div>
    );
  }

  if (run.status === "error" && work.error) {
    return (
      <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger-ink">
        {work.error}
      </div>
    );
  }

  return null;
}
