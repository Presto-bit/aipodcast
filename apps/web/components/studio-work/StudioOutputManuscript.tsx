"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_META,
  STUDIO_MANUSCRIPT_TITLE
} from "../../lib/studioOutputTypography";
import {
  buildManuscriptFlowText,
  manuscriptTitleBlocks,
  resolveBodyForTitleIndex,
  resolvePrimaryTitleIndex,
  studioTitleDirectionLabel
} from "../../lib/studioManuscriptView";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
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

function cloneBlocks(blocks: ManuscriptBlock[]): ManuscriptBlock[] {
  return blocks.map((b) => {
    if (b.kind === "hashtags") return { ...b, tags: [...b.tags] };
    return { ...b };
  });
}

function AutoGrowTextarea({
  value,
  onChange,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      className={`${className} resize-none overflow-hidden`}
      onChange={(e) => {
        onChange(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
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

function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}

/** 输出区稿件：横向 best of N + 对应正文连续排版（无区块与空行） */
export default function StudioOutputManuscript({
  version,
  onTitleIndexChange,
  editable = false,
  onBlocksChange,
  generatingPhase,
  generatingTask
}: {
  version: ManuscriptVersion | null;
  onTitleIndexChange?: (index: number) => void;
  editable?: boolean;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  generatingPhase?: string;
  generatingTask?: string;
}) {
  const sourceBlocks = version?.blocks ?? [];
  const [draftBlocks, setDraftBlocks] = useState<ManuscriptBlock[]>(() => cloneBlocks(sourceBlocks));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamLines, setStreamLines] = useState<string[]>([]);

  useEffect(() => {
    setDraftBlocks(cloneBlocks(sourceBlocks));
  }, [version?.id]);

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

  const scheduleSave = useCallback(
    (next: ManuscriptBlock[]) => {
      if (!editable || !onBlocksChange) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => onBlocksChange(next), 500);
    },
    [editable, onBlocksChange]
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  if (generatingPhase) {
    const label = generatingPhase.trim() || "写稿中…";
    return (
      <div className="text-left">
        <p className="flex items-center gap-2 text-sm text-ink">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
          {label}
        </p>
        {streamLines.length ? (
          <p className={`mt-2 ${STUDIO_MANUSCRIPT_BODY}`}>{streamLines.join(" · ")}</p>
        ) : null}
      </div>
    );
  }

  const blocks = editable ? draftBlocks : sourceBlocks;
  if (!blocks.length) return null;

  const titles = manuscriptTitleBlocks(blocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);
  const primaryTitle = titles[titleIndex] ?? titles[0];
  const body = resolveBodyForTitleIndex(blocks, titleIndex);
  const hashtags = blocks.find((b) => b.kind === "hashtags");
  const cover = blocks.find((b) => b.kind === "coverBrief");
  const showBestOf = titles.length > 1 && Boolean(onTitleIndexChange);

  function patchBlock(nextBlock: ManuscriptBlock) {
    const next = draftBlocks.map((b) => {
      if (nextBlock.kind === "title" || nextBlock.kind === "body") {
        return b.id === nextBlock.id ? nextBlock : b;
      }
      return b.kind === nextBlock.kind ? nextBlock : b;
    });
    setDraftBlocks(next);
    scheduleSave(next);
  }

  const flowText = buildManuscriptFlowText({
    title: primaryTitle?.text,
    body: body?.text,
    hashtags: hashtags && hashtags.kind === "hashtags" ? hashtags.tags : undefined,
    cover: cover && cover.kind === "coverBrief" ? cover.text : undefined
  });

  return (
    <article className="min-w-0 text-left">
      {showBestOf ? (
        <BestOfTabs
          titles={titles}
          titleIndex={titleIndex}
          onTitleIndexChange={onTitleIndexChange!}
        />
      ) : null}

      {editable ? (
        <div className="space-y-2">
          {!showBestOf && primaryTitle ? (
            <AutoGrowTextarea
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_TITLE}`}
              value={primaryTitle.text}
              onChange={(text) => patchBlock({ ...primaryTitle, text })}
            />
          ) : null}
          {body ? (
            <AutoGrowTextarea
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_BODY}`}
              value={body.text}
              onChange={(text) => patchBlock({ ...body, text })}
            />
          ) : null}
          {hashtags && hashtags.kind === "hashtags" ? (
            <input
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_HASHTAGS}`}
              value={hashtagLine(hashtags.tags)}
              onChange={(e) => {
                const tags = e.target.value
                  .split(/[\s,#]+/)
                  .map((t) => t.replace(/^#/, "").trim())
                  .filter(Boolean);
                patchBlock({ ...hashtags, tags });
              }}
            />
          ) : null}
          {cover && cover.kind === "coverBrief" ? (
            <input
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_META}`}
              value={cover.text}
              onChange={(e) => patchBlock({ ...cover, text: e.target.value })}
            />
          ) : null}
        </div>
      ) : flowText ? (
        <p className={STUDIO_MANUSCRIPT_BODY}>{flowText}</p>
      ) : null}

      {version ? (
        <div className="mt-2 flex justify-start">
          <button
            type="button"
            title="复制全部（含话题）"
            aria-label="复制全部（含话题）"
            className="rounded p-1 text-muted hover:text-ink"
            onClick={() =>
              void navigator.clipboard.writeText(manuscriptCopyAll(blocks, titleIndex))
            }
          >
            <IconCopy />
          </button>
        </div>
      ) : null}
    </article>
  );
}
