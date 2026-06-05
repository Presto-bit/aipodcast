"use client";

import { useEffect, useState } from "react";
import { studioGeneratingUiMode } from "../../lib/studioDockLayout";
import { resolvePrimaryTitleIndex } from "../../lib/studioManuscriptView";
import { STUDIO_DIALOGUE_SECTION } from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioStreamingSurface from "./StudioStreamingSurface";
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

/** v3 主画布：流式写作面 / 预览 / 文档 / 对比 */
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
  embedded = false,
  streamingBlocks = null,
  streamingBodyText = null,
  generatingTaskSentence,
  onCancelStream
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
  /** P0-核：流式写画布时的增量 blocks */
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  generatingTaskSentence?: string;
  onCancelStream?: () => void;
}) {
  const compareMode = Boolean(work.pendingPatch);
  const isGenerating = work.status === "generating";

  if (isGenerating && !compareMode) {
    const streamingShell = (
      <StudioStreamingSurface
        phase={work.runPhase}
        taskSentence={generatingTaskSentence || work.brief}
        blocks={streamingBlocks}
        bodyText={streamingBodyText}
        onCancel={onCancelStream}
      />
    );
    if (embedded) {
      return (
        <section className="mt-6 px-0.5 pb-4">
          <p className={STUDIO_DIALOGUE_SECTION}>稿件</p>
          <div className="mt-2 min-h-[240px] overflow-hidden rounded-xl border border-line/60">
            {streamingShell}
          </div>
        </section>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/60 bg-surface shadow-sm">
        {streamingShell}
      </div>
    );
  }

  const generatingMode = studioGeneratingUiMode(work, activeVersion);
  const showFinalTabs = true;

  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const liveBlocks = manuscriptBlocks;
  const showManuscript =
    liveBlocks.length > 0 && (work.status === "ready" || work.status === "shipped" || compareMode);
  const titleIndex = resolvePrimaryTitleIndex(
    compareMode ? null : activeVersion,
    liveBlocks.filter((b) => b.kind === "title").length
  );

  const availableTabs: CanvasTab[] = compareMode ? ["document", "preview", "diff"] : ["document", "preview"];

  const [tab, setTab] = useState<CanvasTab>("document");

  useEffect(() => {
    if (compareMode) setTab("diff");
    else if (tab === "diff") setTab("document");
  }, [compareMode, work.pendingPatch?.fromVersionId, generatingMode]);

  const editable =
    work.status === "ready" && !compareMode && !busy && Boolean(onBlocksChange);

  const versionRow =
    versions.length > 1 && onVersionChange && !compareMode ? (
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

      {showManuscript && showFinalTabs && tab === "preview" && !compareMode ? (
        <StudioXhsPhonePreview
          version={activeVersion}
          blocks={liveBlocks}
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
          onSelectionRevise={work.status === "ready" && !compareMode ? onSelectionRevise : undefined}
        />
      ) : null}

      {!showManuscript && work.status === "draft" ? (
        <p className="py-12 text-center text-sm text-muted">
          在下方描述创作需求；信息足够后将在此流式写稿
        </p>
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
