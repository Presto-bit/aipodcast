"use client";

import { useEffect, useMemo, useState } from "react";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import {
  buildManuscriptFlowText,
  manuscriptTitleBlocks,
  resolveBodyForTitleIndex,
  resolveManuscriptVariant,
  studioTitleDirectionLabel
} from "../../lib/studioManuscriptView";
import { STUDIO_STREAM_BODY, STUDIO_STREAM_CURSOR } from "../../lib/studioOutputTypography";
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
  onTitleIndexChange?: (index: number) => void;
  flowLayout?: boolean;
}) {
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const isActive = variant === "active";
  const isReadyLike = variant === "ready";
  const displayBlocks = useMemo(() => {
    if (blocks?.length) return blocks;
    return version?.blocks ?? [];
  }, [blocks, version?.blocks]);

  const blockBody = resolveBodyForTitleIndex(displayBlocks, previewIndex)?.text ?? "";
  const targetBody = (bodyText ?? blockBody).trim();
  const displayBody = isReadyLike ? blockBody.trim() : targetBody;
  const titles = useMemo(() => manuscriptTitleBlocks(displayBlocks), [displayBlocks]);
  const hasContent = Boolean(displayBody || titles.length);
  const titleIndex = version ? (version.primaryTitleIndex ?? previewIndex) : previewIndex;
  const activeIndex = onTitleIndexChange ? titleIndex : previewIndex;

  useEffect(() => {
    if (previewIndex >= titles.length) setPreviewIndex(0);
  }, [previewIndex, titles.length]);

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
      <StudioOutputManuscript version={version} onTitleIndexChange={onTitleIndexChange} />
    );
  }

  if (flowLayout) {
    if (!hasContent) {
      return (
        <div className="text-left">
          {streamLines.length ? (
            <p className="text-[13px] leading-relaxed text-muted">{streamLines.join(" · ")}</p>
          ) : null}
          {isActive ? (
            <p className={`mt-2 ${STUDIO_STREAM_BODY} text-muted/70`}>
              <StreamCursor />
            </p>
          ) : (
            <p className="text-[13px] text-muted">准备根据你的需求撰写笔记…</p>
          )}
        </div>
      );
    }

    const slice = resolveManuscriptVariant(displayBlocks, activeIndex);
    const streamBody = displayBody || slice.body;
    const flowText = buildManuscriptFlowText({
      title: slice.title,
      body: streamBody,
      interaction: slice.interaction,
      hashtags: slice.hashtags,
      cover: slice.cover
    });

    return (
      <article className="text-left">
        {streamLines.length > 1 ? (
          <p className="mb-2 text-[11px] leading-snug text-muted/90">
            {streamLines.slice(-2).join(" · ")}
          </p>
        ) : null}

        {titles.length > 1 ? (
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[10px] text-muted">best of {titles.length}</span>
            {titles.map((t, i) => (
              <button
                key={t.id}
                type="button"
                title={t.text}
                className={`text-[11px] transition ${
                  i === activeIndex
                    ? "font-medium text-brand underline decoration-brand underline-offset-4"
                    : "text-muted hover:text-ink"
                }`}
                onClick={() => {
                  setPreviewIndex(i);
                  onTitleIndexChange?.(i);
                }}
              >
                {studioTitleDirectionLabel(i)}
              </button>
            ))}
          </div>
        ) : null}

        {flowText ? (
          <p className={STUDIO_STREAM_BODY}>
            {flowText}
            {isActive ? <StreamCursor /> : null}
          </p>
        ) : isActive ? (
          <p className={`${STUDIO_STREAM_BODY} text-muted/70`}>
            <StreamCursor />
          </p>
        ) : null}

        {onCancel && isActive ? (
          <button
            type="button"
            className="mt-2 text-[11px] text-muted underline hover:text-ink"
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
