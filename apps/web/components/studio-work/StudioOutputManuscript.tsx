"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_META,
  STUDIO_MANUSCRIPT_TITLE
} from "../../lib/studioOutputTypography";
import {
  bodyHasCorpusAnchors,
  manuscriptTitleBlocks,
  resolvePrimaryTitleIndex
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

/** 输出区稿件：标题 + 正文 + 话题，连续排版（无内嵌滚动与卡片分割） */
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
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-ink">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
          {label}
        </p>
        {streamLines.map((line) => (
          <p key={line} className={`text-sm leading-relaxed text-ink/85 ${STUDIO_MANUSCRIPT_BODY}`}>
            {line}
          </p>
        ))}
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

  return (
    <article className="min-w-0 space-y-3">
      {primaryTitle ? (
        editable ? (
          <textarea
            className={`w-full resize-none border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_TITLE}`}
            rows={2}
            value={primaryTitle.text}
            onChange={(e) => patchBlock({ ...primaryTitle, text: e.target.value })}
          />
        ) : (
          <h1 className={STUDIO_MANUSCRIPT_TITLE}>{primaryTitle.text}</h1>
        )
      ) : null}

      {titles.length > 1 && onTitleIndexChange ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {titles.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className={i === titleIndex ? "text-brand underline" : "underline hover:text-ink"}
              onClick={() => onTitleIndexChange(i)}
            >
              标题 {i + 1}
            </button>
          ))}
        </div>
      ) : null}

      {body && body.kind === "body" ? (
        <>
          {body.evidence === "corpus" || bodyHasCorpusAnchors(body.text) ? (
            <p className="text-[10px] text-brand/85">正文含资料锚点</p>
          ) : null}
          {editable ? (
            <textarea
              className={`w-full resize-none border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_BODY}`}
              rows={12}
              value={body.text}
              onChange={(e) => patchBlock({ ...body, text: e.target.value })}
            />
          ) : (
            <p className={`whitespace-pre-wrap ${STUDIO_MANUSCRIPT_BODY}`}>{body.text}</p>
          )}
        </>
      ) : null}

      {hashtags && hashtags.kind === "hashtags" ? (
        editable ? (
          <input
            className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_HASHTAGS}`}
            value={hashtags.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
            onChange={(e) => {
              const tags = e.target.value
                .split(/[\s,#]+/)
                .map((t) => t.replace(/^#/, "").trim())
                .filter(Boolean);
              patchBlock({ ...hashtags, tags });
            }}
          />
        ) : (
          <p className={STUDIO_MANUSCRIPT_HASHTAGS}>
            {hashtags.tags.map((t) => (
              <span key={t} className="mr-2">
                #{t.replace(/^#/, "")}
              </span>
            ))}
          </p>
        )
      ) : null}

      {cover && cover.kind === "coverBrief" ? (
        editable ? (
          <input
            className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_META}`}
            value={cover.text}
            onChange={(e) => patchBlock({ ...cover, text: e.target.value })}
          />
        ) : (
          <p className={STUDIO_MANUSCRIPT_META}>封面：{cover.text}</p>
        )
      ) : null}

      {version ? (
        <div className="flex justify-end pt-1">
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
