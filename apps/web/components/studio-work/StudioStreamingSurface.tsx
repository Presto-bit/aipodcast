"use client";

import { useEffect, useMemo, useState } from "react";
import {
  manuscriptBodyBlocks,
  manuscriptTitleBlocks,
  resolveManuscriptVariant
} from "../../lib/studioManuscriptView";
import { studioStreamPhaseLabel } from "../../lib/studioComposeProgress";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioManuscriptReadable, { StudioVariantTabs } from "./StudioManuscriptReadable";

export type StudioStreamingVariant = "idle" | "active" | "ready" | "diff";

function StreamPhaseHint({ label }: { label: string }) {
  if (!label.trim()) return null;
  return (
    <p className="mb-2 flex items-center gap-2 text-[11px] text-brand">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden />
      {label}
    </p>
  );
}

/** Cursor 式 Agent 输出面：流式 / 成稿（flowLayout 时参与页面全局滚动） */
export default function StudioStreamingSurface({
  phase,
  taskSentence,
  blocks,
  bodyText,
  onCancel,
  variant = "active",
  version = null,
  onTitleIndexChange,
  flowLayout = false,
  isRevise = false,
  corpusNotebook = "",
  corpusNoteIds = []
}: {
  phase?: string;
  taskSentence?: string;
  blocks: ManuscriptBlock[] | null;
  bodyText?: string | null;
  onCancel?: () => void;
  variant?: StudioStreamingVariant;
  version?: ManuscriptVersion | null;
  onTitleIndexChange?: (index: number) => void;
  flowLayout?: boolean;
  isRevise?: boolean;
  corpusNotebook?: string;
  corpusNoteIds?: string[];
}) {
  void taskSentence;
  const [previewIndex, setPreviewIndex] = useState(0);

  const isActive = variant === "active";
  const isReadyLike = variant === "ready";
  const displayBlocks = useMemo(() => {
    if (blocks?.length) return blocks;
    return version?.blocks ?? [];
  }, [blocks, version?.blocks]);

  const titles = useMemo(() => manuscriptTitleBlocks(displayBlocks), [displayBlocks]);
  const bodyCount = useMemo(() => manuscriptBodyBlocks(displayBlocks).length, [displayBlocks]);
  const showVariantTabs = titles.length > 1 && (!isActive || bodyCount > 1);
  const hasContent = Boolean(
    bodyText?.trim() ||
      titles.length ||
      displayBlocks.some((b) => b.kind === "body" && b.text.trim())
  );
  const titleIndex = version ? (version.primaryTitleIndex ?? previewIndex) : previewIndex;
  const activeIndex = onTitleIndexChange ? titleIndex : previewIndex;

  const streamPhase = isActive
    ? studioStreamPhaseLabel({ runPhase: phase, hasStream: hasContent, isRevise })
    : "";

  useEffect(() => {
    if (previewIndex >= titles.length) setPreviewIndex(0);
  }, [previewIndex, titles.length]);

  if (isReadyLike && version) {
    return (
      <StudioOutputManuscript
        version={version}
        onTitleIndexChange={onTitleIndexChange}
        corpusNotebook={corpusNotebook}
        corpusNoteIds={corpusNoteIds}
      />
    );
  }

  if (flowLayout) {
    if (!hasContent) {
      return isActive ? (
        <div className="text-left">
          <StreamPhaseHint label={streamPhase} />
          <div className="min-h-[3rem]" aria-hidden />
        </div>
      ) : null;
    }

    const slice = resolveManuscriptVariant(displayBlocks, activeIndex);
    const streamingBody = bodyText?.trim();
    const streamVariant =
      isActive && streamingBody && activeIndex === 0
        ? { ...slice, body: streamingBody }
        : slice;

    return (
      <div className="text-left">
        <StreamPhaseHint label={streamPhase} />

        {showVariantTabs ? (
          <StudioVariantTabs
            titles={titles}
            titleIndex={activeIndex}
            onTitleIndexChange={(i) => {
              setPreviewIndex(i);
              onTitleIndexChange?.(i);
            }}
          />
        ) : null}

        <StudioManuscriptReadable
          key={activeIndex}
          variant={streamVariant}
          trailingCursor={isActive}
          corpusNotebook={corpusNotebook}
          corpusNoteIds={corpusNoteIds}
        />

        {onCancel && isActive ? (
          <button
            type="button"
            className="mt-2 text-[11px] text-muted underline hover:text-ink"
            onClick={onCancel}
          >
            停止
          </button>
        ) : null}
      </div>
    );
  }

  return <StudioOutputManuscript version={null} generatingPhase={phase || "写稿中…"} />;
}
