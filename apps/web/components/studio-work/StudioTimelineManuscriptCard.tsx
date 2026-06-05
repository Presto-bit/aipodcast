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

type CardTab = "preview" | "document" | "diff";

function tabLabel(tab: CardTab): string {
  switch (tab) {
    case "preview":
      return "预览";
    case "document":
      return "文档";
    case "diff":
      return "对比";
    default:
      return tab;
  }
}

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
  const showFinal = !isRunning || compareMode;

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

  const availableTabs: CardTab[] = compareMode
    ? ["preview", "document", "diff"]
    : showFinal
      ? ["preview", "document"]
      : run.tool === "revise" && baseVersion
        ? ["document"]
        : [];

  const [tab, setTab] = useState<CardTab>("preview");

  useEffect(() => {
    if (compareMode) setTab("diff");
    else if (isRunning && run.tool === "revise") setTab("document");
    else if (tab === "diff") setTab("preview");
  }, [compareMode, isRunning, run.tool, pendingPatch?.fromVersionId]);

  const editable =
    isActiveVersion &&
    work.status === "ready" &&
    !compareMode &&
    !isRunning &&
    !busy &&
    Boolean(onBlocksChange && version);

  const headerLabel = version?.label ?? (run.tool === "revise" ? "改版" : "成稿");

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
        {isRunning ? (
          <span className="text-[10px] text-brand">{work.runPhase || run.summary || "写稿中…"}</span>
        ) : null}
      </div>

      <div className="rounded-lg border border-line/50 bg-fill/20 px-3 py-2.5">
        {isRunning && !compareMode ? (
          <div className="mb-2 flex items-center gap-2 text-sm text-ink">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
            <span>{work.runPhase || run.summary || "写稿中…"}</span>
          </div>
        ) : null}

        {availableTabs.length > 0 ? (
          <div className="mb-2 flex gap-1">
            {availableTabs.map((t) => (
              <button
                key={t}
                type="button"
                className={
                  tab === t
                    ? "rounded-md bg-fill px-2.5 py-1 text-xs font-medium text-ink"
                    : "rounded-md px-2.5 py-1 text-xs text-muted hover:bg-fill/60 hover:text-ink"
                }
                onClick={() => setTab(t)}
              >
                {tabLabel(t)}
              </button>
            ))}
          </div>
        ) : null}

        {isRunning && run.tool === "revise" && baseVersion && tab === "document" ? (
          <StudioOutputManuscript version={baseVersion} />
        ) : null}

        {showFinal && displayBlocks.length > 0 && tab === "preview" ? (
          <StudioXhsPhonePreview
            version={compareMode ? null : version}
            blocks={displayBlocks}
            titleIndex={titleIndex}
          />
        ) : null}

        {showFinal && displayBlocks.length > 0 && tab === "document" && !compareMode && version ? (
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

        {showFinal && compareMode && pendingPatch && tab === "document" ? (
          <StudioOutputManuscript
            version={null}
            compareBlocks={pendingPatch.proposedBlocks}
            compareMode
            selectedKeys={selectedPatchKeys}
            changedKeys={patchChangedKeys}
            onToggleKey={onTogglePatchKey}
          />
        ) : null}

        {showFinal && compareMode && pendingPatch && tab === "diff" ? (
          <StudioOutputManuscript
            version={null}
            compareBlocks={pendingPatch.proposedBlocks}
            compareMode
            selectedKeys={selectedPatchKeys}
            changedKeys={patchChangedKeys}
            onToggleKey={onTogglePatchKey}
          />
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
