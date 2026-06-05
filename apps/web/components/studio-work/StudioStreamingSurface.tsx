"use client";

import { useEffect, useMemo, useState } from "react";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import {
  flattenManuscriptDisplayText,
  manuscriptTitleBlocks,
  studioTitleDirectionLabel
} from "../../lib/studioManuscriptView";
import { STUDIO_STREAM_BODY, STUDIO_STREAM_CURSOR } from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

function StreamCursor() {
  return <span className={STUDIO_STREAM_CURSOR} aria-hidden />;
}

export type StudioStreamingVariant = "idle" | "active" | "ready" | "diff";

function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
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

    const flowParts: string[] = [];
    if (titles.length <= 1 && titles[0]?.text) {
      flowParts.push(titles[0].text);
    }
    if (displayBody) {
      flowParts.push(flattenManuscriptDisplayText(displayBody));
    }
    if (hashtags && hashtags.kind === "hashtags" && hashtags.tags.length) {
      flowParts.push(hashtagLine(hashtags.tags));
    }
    if (cover && cover.kind === "coverBrief" && cover.text.trim()) {
      flowParts.push(`封面：${flattenManuscriptDisplayText(cover.text)}`);
    }
    const flowText = flowParts.join(" ");

    return (
      <article className="text-left">
        {streamLines.length > 1 ? (
          <p className="mb-2 text-[11px] leading-snug text-muted/90">
            {streamLines.slice(-2).join(" · ")}
          </p>
        ) : null}

        {titles.length > 1 ? (
          <div className="mb-3">
            <p className="text-[11px] font-medium tracking-wide text-muted">
              best of {titles.length}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {titles.map((t, i) => (
                <div
                  key={t.id}
                  className={`rounded-lg border px-3 py-2 ${
                    i === 0 ? "border-brand/60 bg-brand/5" : "border-line/40"
                  }`}
                >
                  <span className="text-[10px] font-medium text-muted">
                    {studioTitleDirectionLabel(i)}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink">{t.text}</span>
                </div>
              ))}
            </div>
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
