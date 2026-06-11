"use client";

import { useMemo } from "react";
import {
  manuscriptTitleBlocks,
  resolveManuscriptVariant
} from "../../lib/studioManuscriptView";
import { studioStreamPhaseLabel } from "../../lib/studioComposeProgress";
import type { NotesAskSource } from "../../lib/notesAskCitation";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioManuscriptReadable from "./StudioManuscriptReadable";

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

/** V2：流式单稿，无方向 Tab */
export default function StudioStreamingSurface({
  phase,
  taskSentence,
  blocks,
  bodyText,
  onCancel,
  variant = "active",
  version = null,
  flowLayout = false,
  isRevise = false,
  corpusNotebook = "",
  corpusNoteIds = [],
  corpusSources
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
  corpusSources?: NotesAskSource[];
}) {
  void taskSentence;
  const isActive = variant === "active";
  const isReadyLike = variant === "ready";
  const displayBlocks = useMemo(() => {
    if (blocks?.length) return blocks;
    return version?.blocks ?? [];
  }, [blocks, version?.blocks]);

  const titles = useMemo(() => manuscriptTitleBlocks(displayBlocks), [displayBlocks]);
  const hasContent = Boolean(
    bodyText?.trim() ||
      titles.length ||
      displayBlocks.some((b) => b.kind === "body" && b.text.trim())
  );

  const streamPhase = isActive
    ? studioStreamPhaseLabel({ runPhase: phase, hasStream: hasContent, isRevise })
    : "";

  if (isReadyLike && version) {
    return (
      <StudioOutputManuscript
        version={version}
        corpusNotebook={corpusNotebook}
        corpusNoteIds={corpusNoteIds}
        corpusSources={corpusSources}
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

    const slice = resolveManuscriptVariant(displayBlocks, 0);
    const streamingBody = bodyText?.trim();
    const streamVariant =
      isActive && streamingBody ? { ...slice, body: streamingBody } : slice;

    return (
      <div className="text-left">
        <StreamPhaseHint label={streamPhase} />

        <StudioManuscriptReadable
          variant={streamVariant}
          trailingCursor={isActive}
          corpusNotebook={corpusNotebook}
          corpusNoteIds={corpusNoteIds}
          corpusSources={corpusSources}
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
