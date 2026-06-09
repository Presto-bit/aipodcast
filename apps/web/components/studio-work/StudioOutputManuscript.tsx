"use client";

import {
  manuscriptTitleBlocks,
  resolveManuscriptVariant,
  resolvePrimaryTitleIndex
} from "../../lib/studioManuscriptView";
import type { ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import StudioManuscriptReadable from "./StudioManuscriptReadable";

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

/** V2：单标题输出，支持选区 */
export default function StudioOutputManuscript({
  version,
  generatingPhase,
  corpusNotebook = "",
  corpusNoteIds = [],
  selectionHighlight,
  onTextSelect
}: {
  version: ManuscriptVersion | null;
  onTitleIndexChange?: (index: number) => void;
  generatingPhase?: string;
  generatingTask?: string;
  corpusNotebook?: string;
  corpusNoteIds?: string[];
  selectionHighlight?: string;
  onTextSelect?: (text: string) => void;
}) {
  const sourceBlocks = version?.blocks ?? [];
  const titles = manuscriptTitleBlocks(sourceBlocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);

  if (generatingPhase) {
    return <div className="min-h-[4rem]" aria-hidden />;
  }

  if (!sourceBlocks.length) return null;

  const variant = resolveManuscriptVariant(sourceBlocks, titleIndex);

  return (
    <div className="min-w-0 text-left">
      <StudioManuscriptReadable
        variant={variant}
        corpusNotebook={corpusNotebook}
        corpusNoteIds={corpusNoteIds}
        selectionHighlight={selectionHighlight}
        onTextSelect={onTextSelect}
      />

      {version ? (
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            title="复制全部"
            aria-label="复制全部"
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
