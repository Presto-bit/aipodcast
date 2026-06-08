"use client";

import { useEffect, useMemo, useState } from "react";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import {
  manuscriptTitleBlocks,
  resolveBodyForTitleIndex,
  resolveManuscriptVariant
} from "../../lib/studioManuscriptView";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";
import StudioEphemeralHint from "./StudioEphemeralHint";
import StudioManuscriptReadable, { StudioVariantTabs } from "./StudioManuscriptReadable";

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
  const [streamHint, setStreamHint] = useState("");
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
    setStreamHint([taskLine, phaseLine].filter(Boolean).join(" · "));
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
          {streamHint ? <StudioEphemeralHint text={streamHint} ttlMs={4000} /> : null}
          {isActive ? (
            <p className="mt-2 text-[13px] text-muted/70">正在撰写…</p>
          ) : (
            <p className="text-[13px] text-muted">准备根据你的需求撰写笔记…</p>
          )}
        </div>
      );
    }

    const slice = resolveManuscriptVariant(displayBlocks, activeIndex);
    const streamVariant = {
      ...slice,
      body: displayBody || slice.body
    };

    return (
      <div className="text-left">
        {streamHint ? (
          <StudioEphemeralHint text={streamHint} ttlMs={4000} className="mb-2" />
        ) : null}

        {titles.length > 1 ? (
          <StudioVariantTabs
            titles={titles}
            titleIndex={activeIndex}
            onTitleIndexChange={(i) => {
              setPreviewIndex(i);
              onTitleIndexChange?.(i);
            }}
          />
        ) : null}

        <StudioManuscriptReadable variant={streamVariant} trailingCursor={isActive} />

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

  return (
    <StudioOutputManuscript
      version={null}
      generatingPhase={phase || "写稿中…"}
      generatingTask={taskSentence}
    />
  );
}
