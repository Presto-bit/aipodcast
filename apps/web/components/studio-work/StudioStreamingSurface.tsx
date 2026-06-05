"use client";

import { useEffect, useMemo, useState } from "react";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import { manuscriptTitleBlocks } from "../../lib/studioManuscriptView";
import {
  STUDIO_STREAM_BODY,
  STUDIO_STREAM_CURSOR,
  STUDIO_STREAM_META,
  STUDIO_STREAM_TITLE
} from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

function StreamCursor() {
  return <span className={STUDIO_STREAM_CURSOR} aria-hidden />;
}

export type StudioStreamingVariant = "idle" | "active" | "ready" | "diff";

/** Cursor 式 Agent 输出面：流式 / 成稿（flowLayout 时参与页面全局滚动） */
export default function StudioStreamingSurface({
  phase,
  taskSentence,
  blocks,
  bodyText,
  onCancel,
  variant = "active",
  version = null,
  editable = false,
  onBlocksChange,
  onTitleIndexChange,
  flowLayout = false
}: {
  phase?: string;
  taskSentence?: string;
  blocks: ManuscriptBlock[] | null;
  bodyText?: string | null;
  onCancel?: () => void;
  variant?: StudioStreamingVariant;
  version?: ManuscriptVersion | null;
  editable?: boolean;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onTitleIndexChange?: (index: number) => void;
  flowLayout?: boolean;
}) {
  const [streamLines, setStreamLines] = useState<string[]>([]);

  const isActive = variant === "active";
  const isReadyLike = variant === "ready";
  const displayBlocks = useMemo(() => {
    if (blocks?.length) return blocks;
    return version?.blocks ?? [];
  }, [blocks, version?.blocks]);

  const blockBody = displayBlocks.find((b) => b.kind === "body")?.text ?? "";
  const targetBody = (bodyText ?? blockBody).trim();
  const displayBody = isReadyLike ? blockBody.trim() : targetBody;
  const titles = useMemo(() => manuscriptTitleBlocks(displayBlocks), [displayBlocks]);
  const hashtags = displayBlocks.find((b) => b.kind === "hashtags");
  const cover = displayBlocks.find((b) => b.kind === "coverBrief");
  const hasContent = Boolean(displayBody || titles.length);

  useEffect(() => {
    if (isReadyLike) return;
    const label = phase?.trim();
    if (!label) return;
    const taskLine = taskSentence?.trim()
      ? `任务 · ${taskSentence.trim().slice(0, 120)}`
      : null;
    const phaseLine = phaseToGenerateStreamLine(label);
    setStreamLines((prev) => {
      const next = [...prev];
      if (taskLine && !next.includes(taskLine)) next.unshift(taskLine);
      if (!next.includes(phaseLine)) next.push(phaseLine);
      return next.slice(-6);
    });
  }, [phase, taskSentence, isReadyLike]);

  if (isReadyLike && version) {
    return (
      <StudioOutputManuscript
        version={version}
        editable={editable}
        onBlocksChange={onBlocksChange}
        onTitleIndexChange={onTitleIndexChange}
      />
    );
  }

  if (flowLayout) {
    if (!hasContent) {
      return (
        <div className="space-y-2 text-left">
          {streamLines.map((line) => (
            <p key={line} className="text-[13px] leading-relaxed text-muted">
              {line}
            </p>
          ))}
          {isActive ? (
            <p className={`${STUDIO_STREAM_BODY} text-muted/70`}>
              <StreamCursor />
            </p>
          ) : (
            <p className="text-[13px] text-muted">准备根据你的需求撰写笔记…</p>
          )}
        </div>
      );
    }

    const primaryTitle = titles[0];

    return (
      <article className="space-y-3 text-left">
        {streamLines.length > 1
          ? streamLines.slice(-2).map((line) => (
              <p key={line} className="text-[11px] leading-snug text-muted/90">
                {line}
              </p>
            ))
          : null}
        {primaryTitle ? <h1 className={STUDIO_STREAM_TITLE}>{primaryTitle.text}</h1> : null}
        {displayBody ? (
          <p className={`whitespace-pre-wrap ${STUDIO_STREAM_BODY}`}>
            {displayBody}
            {isActive ? <StreamCursor /> : null}
          </p>
        ) : isActive ? (
          <p className={`whitespace-pre-wrap ${STUDIO_STREAM_BODY} text-muted/70`}>
            <StreamCursor />
          </p>
        ) : null}
        {hashtags && hashtags.kind === "hashtags" && hashtags.tags.length ? (
          <p className={STUDIO_STREAM_META}>
            {hashtags.tags.map((t) => (
              <span key={t} className="mr-2 text-brand">
                #{t.replace(/^#/, "")}
              </span>
            ))}
          </p>
        ) : null}
        {cover && cover.kind === "coverBrief" && cover.text ? (
          <p className={STUDIO_STREAM_META}>封面 · {cover.text}</p>
        ) : null}
        {onCancel && isActive ? (
          <button
            type="button"
            className="text-[11px] text-muted underline hover:text-ink"
            onClick={onCancel}
          >
            停止
          </button>
        ) : null}
      </article>
    );
  }

  return (
    <StudioOutputManuscript
      version={null}
      generatingPhase={phase || "写稿中…"}
      generatingTask={taskSentence}
    />
  );
}
