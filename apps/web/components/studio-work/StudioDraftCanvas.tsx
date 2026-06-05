"use client";

import { useEffect, useState } from "react";
import { resolvePrimaryTitleIndex } from "../../lib/studioManuscriptView";
import type { ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
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

/** v3 主画布：预览 / 文档 / 对比（有 pendingPatch 时） */
export default function StudioDraftCanvas({
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
  onDismissFeatureNudge,
  onTitleIndexChange,
  onWowRevise
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
  onTitleIndexChange?: (index: number) => void;
  onWowRevise?: (opinion: string) => void;
}) {
  const compareMode = Boolean(work.pendingPatch);
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
    ? ["preview", "document", "diff"]
    : ["preview", "document"];
  const [tab, setTab] = useState<CanvasTab>("preview");

  useEffect(() => {
    if (compareMode) setTab("diff");
    else if (tab === "diff") setTab("preview");
  }, [compareMode, work.pendingPatch?.fromVersionId]);

  const showGenerating = work.status === "generating";

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line/60 bg-fill/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/50 px-3 py-2">
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
        {showGenerating ? (
          <span className="truncate text-xs text-muted">{work.runPhase || "生成中…"}</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {work.error ? (
          <p className="text-[13px] text-danger-ink">{work.error}</p>
        ) : null}

        {showGenerating && !showManuscript ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
            {work.runPhase || "正在写稿…"}
          </div>
        ) : null}

        {showManuscript && tab === "preview" && !compareMode ? (
          <StudioXhsPhonePreview
            version={activeVersion}
            blocks={manuscriptBlocks}
            titleIndex={titleIndex}
          />
        ) : null}

        {showManuscript && tab === "preview" && compareMode ? (
          <StudioXhsPhonePreview version={null} blocks={manuscriptBlocks} titleIndex={0} />
        ) : null}

        {showManuscript && tab === "document" ? (
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
          />
        ) : null}

        {showManuscript && tab === "diff" && compareMode && work.pendingPatch ? (
          <StudioOutputManuscript
            version={null}
            compareBlocks={work.pendingPatch.proposedBlocks}
            compareMode
            selectedKeys={selectedPatchKeys}
            changedKeys={changedKeys}
            onToggleKey={onTogglePatchKey}
          />
        ) : null}
      </div>

      {work.pendingPatch && onApplyPatch && onDiscardPatch ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/50 px-3 py-2 text-[11px]">
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
        <p className="shrink-0 border-t border-line/50 px-3 py-2 text-[11px] text-muted">
          下一篇想更像自己，可去对话页填写「我的特色」。
          <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
            去填写
          </button>
          <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
            暂不
          </button>
        </p>
      ) : null}
    </div>
  );
}
