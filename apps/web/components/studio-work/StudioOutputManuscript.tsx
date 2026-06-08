"use client";

import { useEffect, useState } from "react";
import {
  manuscriptTitleBlocks,
  resolveManuscriptVariant,
  resolvePrimaryTitleIndex
} from "../../lib/studioManuscriptView";
import type { ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import StudioManuscriptReadable, { StudioVariantTabs } from "./StudioManuscriptReadable";

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

/** 输出区稿件：方向 Tab 切换三篇成稿，结构化只读排版 */
export default function StudioOutputManuscript({
  version,
  onTitleIndexChange,
  generatingPhase,
  corpusNotebook = "",
  corpusNoteIds = []
}: {
  version: ManuscriptVersion | null;
  onTitleIndexChange?: (index: number) => void;
  /** 写稿进度仅展示在成稿区，此处仅占位 */
  generatingPhase?: string;
  generatingTask?: string;
  corpusNotebook?: string;
  corpusNoteIds?: string[];
}) {
  const sourceBlocks = version?.blocks ?? [];
  const titles = manuscriptTitleBlocks(sourceBlocks);
  const persistedIndex = resolvePrimaryTitleIndex(version, titles.length);
  const [titleIndex, setTitleIndex] = useState(persistedIndex);

  useEffect(() => {
    setTitleIndex(persistedIndex);
  }, [persistedIndex, version?.id]);

  if (generatingPhase) {
    return <div className="min-h-[4rem]" aria-hidden />;
  }

  if (!sourceBlocks.length) return null;

  const variant = resolveManuscriptVariant(sourceBlocks, titleIndex);
  const showTabs = titles.length > 1 && Boolean(onTitleIndexChange);

  return (
    <div className="min-w-0 text-left">
      {showTabs ? (
        <StudioVariantTabs
          titles={titles}
          titleIndex={titleIndex}
          onTitleIndexChange={(index) => {
            setTitleIndex(index);
            onTitleIndexChange?.(index);
          }}
        />
      ) : null}

      <StudioManuscriptReadable
        key={titleIndex}
        variant={variant}
        corpusNotebook={corpusNotebook}
        corpusNoteIds={corpusNoteIds}
      />

      {version ? (
        <div className="mt-3 flex justify-start">
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
    </div>
  );
}
