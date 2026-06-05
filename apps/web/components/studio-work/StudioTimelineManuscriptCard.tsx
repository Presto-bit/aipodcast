"use client";

import { useEffect, useState } from "react";
import { diffBlockKeys } from "../../lib/studioDeliverable";
import { resolvePrimaryTitleIndex } from "../../lib/studioManuscriptView";
import { studioToolLabel } from "../../lib/studioOrchestrator";
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
  onSelectionRevise,
  onActivate
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
  onActivate?: () => void;
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const compareMode = Boolean(pendingPatch);
  const showPreview = !isRunning && !compareMode && Boolean(version?.blocks.length);

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

  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!showPreview) setPreviewOpen(false);
  }, [showPreview]);

  const editable =
    isActiveVersion &&
    work.status === "ready" &&
    !compareMode &&
    !isRunning &&
    !busy &&
    Boolean(onBlocksChange && version);

  const headerLabel = version?.label ?? (run.tool === "revise" ? "改版" : "成稿");
  const generatingPhase =
    isRunning && !compareMode && run.tool === "generate"
      ? work.runPhase || run.summary || "写稿中…"
      : undefined;

  return (
    <div
      className={[
        "ml-3 border-l-2 pl-3",
        isActiveVersion ? "border-brand/50" : "border-line/40"
      ].join(" ")}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={[
            "rounded-md px-2 py-0.5 text-[11px] font-medium",
            isActiveVersion ? "bg-brand/10 text-brand" : "bg-fill text-muted hover:text-ink"
          ].join(" ")}
          onClick={onActivate}
        >
          稿件 · {headerLabel}
        </button>
        <span className="text-[10px] text-muted">{studioToolLabel(run.tool)}</span>
      </div>

      <div className="rounded-lg border border-line/50 bg-fill/20 px-3 py-2.5">
        {generatingPhase ? (
          <StudioOutputManuscript version={null} generatingPhase={generatingPhase} />
        ) : isRunning && run.tool === "revise" && baseVersion ? (
          <StudioOutputManuscript version={baseVersion} />
        ) : compareMode && pendingPatch ? (
          <StudioOutputManuscript
            version={null}
            compareBlocks={pendingPatch.proposedBlocks}
            compareMode
            selectedKeys={selectedPatchKeys}
            changedKeys={patchChangedKeys}
            onToggleKey={onTogglePatchKey}
          />
        ) : version ? (
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

        {showPreview ? (
          <div className="mt-3 border-t border-line/40 pt-2">
            <button
              type="button"
              className={
                previewOpen
                  ? "rounded-md bg-fill px-2.5 py-1 text-xs font-medium text-ink"
                  : "rounded-md px-2.5 py-1 text-xs text-muted hover:bg-fill/60 hover:text-ink"
              }
              onClick={() => setPreviewOpen((o) => !o)}
            >
              预览
            </button>
            {previewOpen && version ? (
              <div className="mt-2">
                <StudioXhsPhonePreview
                  version={version}
                  blocks={displayBlocks}
                  titleIndex={titleIndex}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {run.status === "error" && work.error ? (
          <p className="mt-2 text-[13px] text-danger-ink">{work.error}</p>
        ) : null}

        {compareMode && pendingPatch && onApplyPatch && onDiscardPatch ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
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
    </div>
  );
}
