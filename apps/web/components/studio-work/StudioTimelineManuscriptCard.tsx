"use client";

import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  StudioRun,
  StudioWork
} from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioStreamingSurface from "./StudioStreamingSurface";

export default function StudioTimelineManuscriptCard({
  work,
  run,
  version,
  baseVersion,
  isActiveVersion,
  busy,
  onTitleIndexChange,
  onBlocksChange,
  streamingBlocks = null,
  streamingBodyText = null
}: {
  work: StudioWork;
  run: StudioRun;
  version: ManuscriptVersion | null;
  baseVersion: ManuscriptVersion | null;
  isActiveVersion: boolean;
  busy: boolean;
  onTitleIndexChange?: (index: number) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const taskSentence = taskSentenceFromWork(work);

  const editable =
    isActiveVersion &&
    work.status === "ready" &&
    !isRunning &&
    !busy &&
    Boolean(onBlocksChange && version);

  if (isRunning) {
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

  if (version && version.blocks.length > 0) {
    return (
      <div className="mt-2">
        <StudioOutputManuscript
          version={version}
          onTitleIndexChange={isActiveVersion ? onTitleIndexChange : undefined}
          editable={editable}
          onBlocksChange={editable ? onBlocksChange : undefined}
        />
      </div>
    );
  }

  if (run.status === "error" && work.error) {
    return <p className="mt-2 text-[13px] text-danger-ink">{work.error}</p>;
  }

  return null;
}
