"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isDraftLikeStatus } from "../../lib/studioWorkMigrate";
import { STUDIO_DIALOGUE_SECTION } from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioStreamingSurface, { type StudioStreamingVariant } from "./StudioStreamingSurface";

/** v3 主画布：统一 Cursor 式 Agent 输出面 */
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
  onCancelStream,
  flowLayout = false
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
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  generatingTaskSentence?: string;
  onCancelStream?: () => void;
  flowLayout?: boolean;
}) {
  const compareMode = Boolean(work.pendingPatch);
  const isGenerating = work.status === "generating";

  const manuscriptBlocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  const hasManuscript =
    manuscriptBlocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode);

  const showActiveStreaming =
    !compareMode &&
    (isGenerating ||
      (busy && Boolean(streamingBlocks?.length || streamingBodyText?.trim())));

  let variant: StudioStreamingVariant = "idle";
  if (showActiveStreaming) variant = "active";
  else if (compareMode && hasManuscript) variant = "diff";
  else if (hasManuscript) variant = "ready";
  else if (isDraftLikeStatus(work.status)) variant = "idle";

  const [mobileVersionOpen, setMobileVersionOpen] = useState(false);
  useEffect(() => {
    setMobileVersionOpen(false);
  }, [work.activeVersionId, compareMode]);

  const editable =
    variant === "ready" &&
    work.status === "ready" &&
    !busy &&
    Boolean(onBlocksChange);

  const patchFooter =
    compareMode && work.pendingPatch && onApplyPatch && onDiscardPatch ? (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
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
    ) : null;

  const featureFooter = showFeatureNudge ? (
    <p className="text-[11px] text-muted">
      下一篇想更像自己，可去对话页填写「我的特色」。
      <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
        去填写
      </button>
      <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
        暂不
      </button>
    </p>
  ) : null;

  const errorFooter = work.error ? (
    <p className="text-[13px] text-danger-ink">{work.error}</p>
  ) : null;

  const footer = errorFooter || patchFooter || featureFooter;

  const surface = (
    <StudioStreamingSurface
      variant={variant}
      phase={
        variant === "active"
          ? work.runPhase || (busy ? "准备写稿…" : undefined)
          : undefined
      }
      taskSentence={generatingTaskSentence || work.brief}
      blocks={variant === "active" ? streamingBlocks : variant === "ready" ? manuscriptBlocks : null}
      bodyText={variant === "active" ? streamingBodyText : null}
      onCancel={variant === "active" ? onCancelStream : undefined}
      version={variant === "ready" ? activeVersion : null}
      compareBlocks={variant === "diff" ? work.pendingPatch?.proposedBlocks ?? null : null}
      editable={editable}
      onBlocksChange={onBlocksChange}
      onTitleIndexChange={onTitleIndexChange}
      onSelectionRevise={onSelectionRevise}
      onWowRevise={onWowRevise}
      wowReviseBusy={busy}
      selectedKeys={selectedPatchKeys}
      changedKeys={changedKeys}
      onToggleKey={onTogglePatchKey}
      versions={versions}
      activeVersionId={work.activeVersionId}
      onVersionChange={onVersionChange}
      footer={
        footer || (variantsNeedMobileVersion(variant, versions) ? (
          <MobileVersionRow
            versions={versions}
            activeVersionId={work.activeVersionId}
            open={mobileVersionOpen}
            onOpenChange={setMobileVersionOpen}
            onVersionChange={onVersionChange}
          />
        ) : null)
      }
      flowLayout={flowLayout}
    />
  );

  if (embedded) {
    return (
      <section className="mt-6 px-0.5 pb-4">
        <p className={STUDIO_DIALOGUE_SECTION}>稿件</p>
        <div className="mt-2 min-h-[240px] overflow-hidden rounded-xl border border-line/60">
          {surface}
        </div>
      </section>
    );
  }

  return flowLayout ? (
    surface
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">{surface}</div>
  );
}

function variantsNeedMobileVersion(variant: StudioStreamingVariant, versions: ManuscriptVersion[]) {
  return variant === "ready" && versions.length > 1;
}

function MobileVersionRow({
  versions,
  activeVersionId,
  open,
  onOpenChange,
  onVersionChange
}: {
  versions: ManuscriptVersion[];
  activeVersionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVersionChange?: (versionId: string) => void;
}) {
  if (!onVersionChange || versions.length <= 1) return null;
  return (
    <div className="sm:hidden">
      <button
        type="button"
        className="text-[11px] text-brand underline"
        onClick={() => onOpenChange(!open)}
      >
        {open ? "收起版本" : "切换版本"}
      </button>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              className={
                v.id === activeVersionId
                  ? "rounded-md bg-fill px-2 py-0.5 text-[10px] font-medium text-ink"
                  : "rounded-md px-2 py-0.5 text-[10px] text-muted hover:bg-fill/60"
              }
              onClick={() => onVersionChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
