"use client";

import { useEffect, useState } from "react";
import { STUDIO_MANUSCRIPT_BODY } from "../../lib/studioOutputTypography";
import {
  buildManuscriptFlowText,
  manuscriptTitleBlocks,
  resolveManuscriptVariant,
  resolvePrimaryTitleIndex,
  studioTitleDirectionLabel
} from "../../lib/studioManuscriptView";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import { studioComposeProgressLabel } from "../../lib/studioComposeProgress";
import { humanizeComposePhase } from "../../lib/studioAgentReadable";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";

function IconCopy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function BestOfTabs({
  titles,
  titleIndex,
  onTitleIndexChange
}: {
  titles: ReturnType<typeof manuscriptTitleBlocks>;
  titleIndex: number;
  onTitleIndexChange: (index: number) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[10px] text-muted">best of {titles.length}</span>
      {titles.map((t, i) => (
        <button
          key={t.id}
          type="button"
          title={t.text}
          className={`text-[11px] transition ${
            i === titleIndex
              ? "font-medium text-brand underline decoration-brand underline-offset-4"
              : "text-muted hover:text-ink"
          }`}
          onClick={() => onTitleIndexChange(i)}
        >
          {studioTitleDirectionLabel(i)}
        </button>
      ))}
    </div>
  );
}

/** 输出区稿件：横向 best of N，整篇只读连续排版 */
export default function StudioOutputManuscript({
  version,
  onTitleIndexChange,
  generatingPhase,
  generatingTask
}: {
  version: ManuscriptVersion | null;
  onTitleIndexChange?: (index: number) => void;
  generatingPhase?: string;
  generatingTask?: string;
}) {
  const sourceBlocks = version?.blocks ?? [];
  const [streamLines, setStreamLines] = useState<string[]>([]);

  useEffect(() => {
    if (!generatingPhase) {
      setStreamLines([]);
      return;
    }
    const taskLine = generatingTask?.trim()
      ? `任务：${generatingTask.trim().slice(0, 160)}`
      : null;
    const phaseLine = phaseToGenerateStreamLine(generatingPhase);
    setStreamLines((prev) => {
      const next = [...prev];
      if (taskLine && !next.includes(taskLine)) next.unshift(taskLine);
      if (!next.includes(phaseLine)) next.push(phaseLine);
      return next;
    });
  }, [generatingPhase, generatingTask]);

  if (generatingPhase) {
    const label =
      studioComposeProgressLabel({ runPhase: generatingPhase }) ||
      humanizeComposePhase(generatingPhase) ||
      "写稿中…";
    return (
      <div className="text-left">
        <p className="flex items-center gap-2 text-sm text-brand">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
          {label}
        </p>
        {streamLines.length ? (
          <p className={`mt-1.5 text-[11px] text-muted ${STUDIO_MANUSCRIPT_BODY}`}>
            {streamLines.slice(-2).join(" · ")}
          </p>
        ) : (
          <p className={`mt-1.5 text-[11px] text-muted ${STUDIO_MANUSCRIPT_BODY}`}>
            通常需要 30 秒到 2 分钟，成稿会出现在下方
          </p>
        )}
      </div>
    );
  }

  if (!sourceBlocks.length) return null;

  const titles = manuscriptTitleBlocks(sourceBlocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);
  const variant = resolveManuscriptVariant(sourceBlocks, titleIndex);
  const showBestOf = titles.length > 1 && Boolean(onTitleIndexChange);
  const flowText = buildManuscriptFlowText({
    title: variant.title,
    body: variant.body,
    interaction: variant.interaction,
    hashtags: variant.hashtags,
    cover: variant.cover
  });

  return (
    <article className="min-w-0 select-text text-left">
      {showBestOf ? (
        <BestOfTabs
          titles={titles}
          titleIndex={titleIndex}
          onTitleIndexChange={onTitleIndexChange!}
        />
      ) : null}

      {flowText ? (
        <p className={`${STUDIO_MANUSCRIPT_BODY} cursor-text`}>{flowText}</p>
      ) : null}

      {version ? (
        <div className="mt-2 flex justify-start">
          <button
            type="button"
            title="复制全部（含话题与互动）"
            aria-label="复制全部（含话题与互动）"
            className="rounded p-1 text-muted hover:text-ink"
            onClick={() =>
              void navigator.clipboard.writeText(manuscriptCopyAll(sourceBlocks, titleIndex))
            }
          >
            <IconCopy />
          </button>
        </div>
      ) : null}
    </article>
  );
}
