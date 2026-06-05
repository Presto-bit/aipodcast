"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_META,
  STUDIO_MANUSCRIPT_TITLE
} from "../../lib/studioOutputTypography";
import {
  flattenManuscriptDisplayText,
  manuscriptTitleBlocks,
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

function BestOfTitlePicker({
  titles,
  titleIndex,
  onTitleIndexChange
}: {
  titles: ReturnType<typeof manuscriptTitleBlocks>;
  titleIndex: number;
  onTitleIndexChange: (index: number) => void;
}) {
  return (
    <div className="mb-3">
      <p className="text-[11px] font-medium tracking-wide text-muted">best of {titles.length}</p>
      <div className="mt-2 flex flex-col gap-2">
        {titles.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-lg border px-3 py-2 text-left transition ${
              i === titleIndex
                ? "border-brand bg-brand/5"
                : "border-line/40 hover:border-line/70"
            }`}
            onClick={() => onTitleIndexChange(i)}
          >
            <span className="text-[10px] font-medium text-muted">{studioTitleDirectionLabel(i)}</span>
            <span className="mt-0.5 block text-sm text-ink">{t.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}

/** 输出区稿件：best of N 标题 + 正文/话题连续排版（无内嵌滚动与区块分割） */
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
  const body = blocks.find((b) => b.kind === "body");
  const hashtags = blocks.find((b) => b.kind === "hashtags");
  const cover = blocks.find((b) => b.kind === "coverBrief");
  const showBestOf = titles.length > 1 && Boolean(onTitleIndexChange);

  function patchBlock(nextBlock: ManuscriptBlock) {
    const next = draftBlocks.map((b) => {
      if (b.kind === nextBlock.kind && (b.kind !== "title" || b.id === nextBlock.id)) {
        return nextBlock;
      }
      return b;
    });
    setDraftBlocks(next);
    scheduleSave(next);
  }

  const flowParts: string[] = [];
  if (!showBestOf && primaryTitle?.text) flowParts.push(primaryTitle.text);
  if (body && body.kind === "body" && body.text.trim()) {
    flowParts.push(flattenManuscriptDisplayText(body.text));
  }
  if (hashtags && hashtags.kind === "hashtags" && hashtags.tags.length) {
    flowParts.push(hashtagLine(hashtags.tags));
  }
  if (cover && cover.kind === "coverBrief" && cover.text.trim()) {
    flowParts.push(`封面：${flattenManuscriptDisplayText(cover.text)}`);
  }
  const flowText = flowParts.join(" ");

  return (
    <article className="min-w-0 text-left">
      {showBestOf ? (
        <BestOfTitlePicker
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
          {body && body.kind === "body" ? (
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
