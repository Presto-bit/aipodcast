"use client";

import { useState } from "react";
import { diffBlockKeys } from "../../lib/studioDeliverable";
import { resolvePrimaryTitleIndex } from "../../lib/studioManuscriptView";
import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  PendingPatch,
  StudioRun,
  StudioWork
} from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioXhsPhonePreview from "./StudioXhsPhonePreview";

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
  onSelectionRevise
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
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const compareMode = Boolean(pendingPatch);
  const taskSentence = taskSentenceFromWork(work);

  const displayBlocks =
    compareMode && pendingPatch
      ? pendingPatch.proposedBlocks
      : version?.blocks ?? [];
  const titleIndex = resolvePrimaryTitleIndex(
    compareMode ? null : version,
    displayBlocks.filter((b) => b.kind === "title").length
  );

  const patchChangedKeys =
    compareMode && pendingPatch && baseVersion
      ? diffBlockKeys(baseVersion.blocks, pendingPatch.proposedBlocks)
      : changedKeys;

  const [docOpen, setDocOpen] = useState(false);

  const editable =
    isActiveVersion &&
    work.status === "ready" &&
    !compareMode &&
    !isRunning &&
    !busy &&
    Boolean(onBlocksChange && version);

  const generatingPhase =
    isRunning && !compareMode && run.tool === "generate"
      ? work.runPhase || run.summary || "写稿中…"
      : undefined;

  if (generatingPhase) {
    return (
      <div className="mt-2">
        <StudioOutputManuscript
          version={null}
          generatingPhase={generatingPhase}
          generatingTask={taskSentence}
        />
      </div>
    );
  }

  if (isRunning && run.tool === "revise" && baseVersion) {
    return (
      <div className="mt-2">
        <StudioOutputManuscript version={baseVersion} />
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
        <StudioXhsPhonePreview
          version={version}
          blocks={displayBlocks}
          titleIndex={titleIndex}
        />
        <button
          type="button"
          className="text-[11px] text-muted underline hover:text-ink"
          onClick={() => setDocOpen((o) => !o)}
        >
          {docOpen ? "收起文档" : "查看文档"}
        </button>
        {docOpen ? (
          <StudioOutputManuscript
            version={version}
            onTitleIndexChange={isActiveVersion ? onTitleIndexChange : undefined}
            onWowRevise={isActiveVersion && work.status === "ready" ? onWowRevise : undefined}
            wowReviseBusy={busy}
            editable={editable}
            onBlocksChange={editable ? onBlocksChange : undefined}
            onSelectionRevise={isActiveVersion ? onSelectionRevise : undefined}
          />
        ) : null}
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
