"use client";

import { useEffect, useState } from "react";
import { studioGeneratingUiMode } from "../../lib/studioDockLayout";
import { resolvePrimaryTitleIndex } from "../../lib/studioManuscriptView";
import { STUDIO_DIALOGUE_SECTION } from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioXhsPhonePreview from "./StudioXhsPhonePreview";

type CanvasTab = "preview" | "document" | "diff";

function tabLabel(tab: CanvasTab): string {
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

function GeneratingProgressBanner({
  runPhase,
  mode
}: {
  runPhase?: string;
  mode: "progress" | "hold-existing";
}) {
  const label = runPhase?.trim() || "写稿中…";
  return (
    <div
      className={[
        "rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5",
        mode === "hold-existing" ? "mb-3" : ""
      ].join(" ")}
    >
      <div className="flex items-center gap-2 text-sm text-ink">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
        <span>{label}</span>
      </div>
      {mode === "hold-existing" ? (
        <p className="mt-1 text-[11px] text-muted">下方为当前稿件，完成后将展示改版结果</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted">完成后将在此展示预览与文档</p>
      )}
    </div>
  );
}

/** v3 主画布：预览 / 文档 / 对比（有 pendingPatch 时） */
export default function StudioDraftCanvas({
  work,
  busy,
  activeVersion,
  versions = [],
  onVersionChange,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  showFeatureNudge,
  onFillFeature,
  onDismissFeatureNudge,
  onTitleIndexChange,
  onWowRevise,
  onBlocksChange,
  onSelectionRevise,
  embedded = false
}: {
  work: StudioWork;
  busy: boolean;
  activeVersion: ManuscriptVersion | null;
  versions?: ManuscriptVersion[];
  onVersionChange?: (versionId: string) => void;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  showFeatureNudge: boolean;
  onFillFeature: () => void;
  onDismissFeatureNudge: () => void;
  onTitleIndexChange?: (index: number) => void;
  onWowRevise?: (opinion: string) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onSelectionRevise?: (selectedText: string, opinion: string) => void;
  embedded?: boolean;
}) {
  const compareMode = Boolean(work.pendingPatch);
  const generatingMode = studioGeneratingUiMode(work, activeVersion);
  const isGenerating = work.status === "generating";
  const showFinalTabs = !isGenerating || compareMode;

  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const showManuscript =
    manuscriptBlocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode);
  const titleIndex = resolvePrimaryTitleIndex(
    compareMode ? null : activeVersion,
    manuscriptBlocks.filter((b) => b.kind === "title").length
  );

  const availableTabs: CanvasTab[] = compareMode
    ? ["document", "preview", "diff"]
    : showFinalTabs
      ? ["document", "preview"]
      : isGenerating
        ? ["document"]
        : [];

  const [tab, setTab] = useState<CanvasTab>("document");

  useEffect(() => {
    if (compareMode) setTab("diff");
    else if (isGenerating) setTab("document");
    else if (tab === "diff") setTab("document");
  }, [compareMode, work.pendingPatch?.fromVersionId, isGenerating, generatingMode]);

  const editable =
    work.status === "ready" &&
    !compareMode &&
    !isGenerating &&
    !busy &&
    Boolean(onBlocksChange);

  const versionRow =
    versions.length > 1 && onVersionChange && !compareMode && !isGenerating ? (
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted">版本</span>
        {versions.map((v) => (
          <button
            key={v.id}
            type="button"
            className={
              v.id === work.activeVersionId
                ? "rounded-md bg-fill px-2 py-0.5 text-[11px] font-medium text-ink"
                : "rounded-md px-2 py-0.5 text-[11px] text-muted hover:bg-fill/60 hover:text-ink"
            }
            onClick={() => onVersionChange(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
    ) : null;

  const tabRow =
    availableTabs.length > 0 ? (
      <div className="flex items-center justify-between gap-2 py-1">
        <div className="flex gap-1">
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
      </div>
    ) : null;

  const body = (
    <>
      {work.error ? <p className="text-[13px] text-danger-ink">{work.error}</p> : null}

      {isGenerating && generatingMode ? (
        <GeneratingProgressBanner runPhase={work.runPhase} mode={generatingMode} />
      ) : null}

      {isGenerating && generatingMode === "hold-existing" && tab === "document" && activeVersion ? (
        <StudioOutputManuscript
          version={activeVersion}
          editable={false}
          onWowRevise={undefined}
        />
      ) : null}

      {showManuscript && showFinalTabs && tab === "preview" && !compareMode ? (
        <StudioXhsPhonePreview
          version={activeVersion}
          blocks={manuscriptBlocks}
          titleIndex={titleIndex}
        />
      ) : null}

      {showManuscript && showFinalTabs && tab === "preview" && compareMode ? (
        <StudioXhsPhonePreview version={null} blocks={manuscriptBlocks} titleIndex={0} />
      ) : null}

      {showManuscript && showFinalTabs && tab === "document" ? (
        <StudioOutputManuscript
          version={compareMode ? null : activeVersion}
          compareBlocks={undefined}
          compareMode={false}
          selectedKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onToggleKey={onTogglePatchKey}
          onTitleIndexChange={compareMode ? undefined : onTitleIndexChange}
          onWowRevise={compareMode || work.status !== "ready" ? undefined : onWowRevise}
          wowReviseBusy={busy}
          editable={editable}
          onBlocksChange={onBlocksChange}
          onSelectionRevise={
            work.status === "ready" && !compareMode && !isGenerating ? onSelectionRevise : undefined
          }
        />
      ) : null}

      {showManuscript && showFinalTabs && tab === "diff" && compareMode && work.pendingPatch ? (
        <StudioOutputManuscript
          version={null}
          compareBlocks={work.pendingPatch.proposedBlocks}
          compareMode
          selectedKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onToggleKey={onTogglePatchKey}
        />
      ) : null}
    </>
  );

  const footnotes = (
    <>
      {work.pendingPatch && onApplyPatch && onDiscardPatch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
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
      ) : null}

      {showFeatureNudge ? (
        <p className="mt-3 text-[11px] text-muted">
          下一篇想更像自己，可去对话页填写「我的特色」。
          <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
            去填写
          </button>
          <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
            暂不
          </button>
        </p>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <section className="mt-6 px-0.5 pb-4">
        <p className={STUDIO_DIALOGUE_SECTION}>稿件</p>
        <div className="mt-2">
          {versionRow}
          {tabRow}
          <div className="mt-2">{body}</div>
          {footnotes}
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line/60 bg-fill/20">
      <div className="flex shrink-0 flex-col gap-1 border-b border-line/50 px-3 py-2">
        {versionRow}
        {tabRow}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">{body}</div>
      <div className="shrink-0 px-3 pb-2">{footnotes}</div>
    </div>
  );
}
