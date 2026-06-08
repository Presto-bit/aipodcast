"use client";

import type { StudioComposePreview } from "../../lib/studioComposePreview";
import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  StudioRun,
  StudioWork
} from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioStreamingSurface from "./StudioStreamingSurface";

function ComposePreviewBanner({
  preview,
  onAdopt
}: {
  preview: StudioComposePreview;
  onAdopt?: () => void;
}) {
  const label =
    preview.reason === "needs_rewrite"
      ? "预览稿·未过质量校验（偏模板化）"
      : "预览稿·待补充信息";
  return (
    <div className="mb-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[12px] text-ink dark:border-amber-900/40 dark:bg-amber-950/30">
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 text-muted">
        内容已保留，可先采纳再在下方修改；或点对话区的「再试一次」让系统重写。
      </p>
      {onAdopt ? (
        <button
          type="button"
          className="mt-2 rounded-md bg-brand px-2.5 py-1 text-[11px] text-brand-foreground hover:opacity-90"
          onClick={onAdopt}
        >
          采纳为稿件
        </button>
      ) : null}
    </div>
  );
}

export default function StudioTimelineManuscriptCard({
  work,
  run,
  version,
  baseVersion,
  isActiveVersion,
  busy,
  onTitleIndexChange,
  onBlocksChange: _onBlocksChange,
  streamingBlocks = null,
  streamingBodyText = null,
  composePreview = null,
  onAdoptComposePreview
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
  composePreview?: StudioComposePreview | null;
  onAdoptComposePreview?: () => void;
}) {
  const isRunning = run.status === "running" && work.status === "generating";
  const taskSentence = taskSentenceFromWork(work);
  const failedPreview =
    composePreview && composePreview.runId === run.id && composePreview.blocks.length > 0
      ? composePreview
      : null;

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
            isRevise={run.tool === "revise"}
            corpusNotebook={work.binding.notebook}
            corpusNoteIds={work.binding.noteIds}
          />
        </div>
      );
    }
    return (
      <div className="mt-2">
        <StudioOutputManuscript
          version={run.tool === "revise" ? baseVersion : null}
          generatingPhase={phase}
          corpusNotebook={work.binding.notebook}
          corpusNoteIds={work.binding.noteIds}
        />
      </div>
    );
  }

  if (failedPreview) {
    const previewVersion: ManuscriptVersion = {
      id: `preview-${run.id}`,
      label: "预览",
      createdAt: Date.now(),
      blocks: failedPreview.blocks,
      sourceRunId: run.id
    };
    return (
      <div className="mt-2">
        <ComposePreviewBanner preview={failedPreview} onAdopt={onAdoptComposePreview} />
        <StudioOutputManuscript
          version={previewVersion}
          onTitleIndexChange={onTitleIndexChange}
          corpusNotebook={work.binding.notebook}
          corpusNoteIds={work.binding.noteIds}
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
          corpusNotebook={work.binding.notebook}
          corpusNoteIds={work.binding.noteIds}
        />
      </div>
    );
  }

  if (run.status === "error" && work.error) {
    return <p className="mt-2 text-[13px] text-danger-ink">{work.error}</p>;
  }

  return null;
}
