"use client";

import { useEffect, useState } from "react";
import { STUDIO_MANUSCRIPT_BODY } from "../../lib/studioOutputTypography";
import {
  manuscriptTitleBlocks,
  resolveManuscriptVariant,
  resolvePrimaryTitleIndex
} from "../../lib/studioManuscriptView";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import { studioComposeProgressLabel } from "../../lib/studioComposeProgress";
import { humanizeComposePhase } from "../../lib/studioAgentReadable";
import type { ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import StudioEphemeralHint from "./StudioEphemeralHint";
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

/** 输出区稿件：标题 chip 切换变体，结构化只读排版 */
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
  const [progressHint, setProgressHint] = useState("");

  useEffect(() => {
    if (!generatingPhase) {
      setProgressHint("");
      return;
    }
    const taskLine = generatingTask?.trim()
      ? `任务：${generatingTask.trim().slice(0, 160)}`
      : "";
    const phaseLine = phaseToGenerateStreamLine(generatingPhase);
    setProgressHint([taskLine, phaseLine].filter(Boolean).join(" · "));
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
        {progressHint ? (
          <StudioEphemeralHint text={progressHint} ttlMs={4000} className="mt-1.5" />
        ) : (
          <StudioEphemeralHint
            text="通常需要 30 秒到 2 分钟，成稿会出现在下方"
            ttlMs={4000}
            className="mt-1.5"
          />
        )}
      </div>
    );
  }

  if (!sourceBlocks.length) return null;

  const titles = manuscriptTitleBlocks(sourceBlocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);
  const variant = resolveManuscriptVariant(sourceBlocks, titleIndex);
  const showTabs = titles.length > 1 && Boolean(onTitleIndexChange);

  return (
    <div className="min-w-0 text-left">
      {showTabs ? (
        <StudioVariantTabs
          titles={titles}
          titleIndex={titleIndex}
          onTitleIndexChange={onTitleIndexChange!}
        />
      ) : null}

      <StudioManuscriptReadable variant={variant} />

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
