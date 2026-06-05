"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import {
  bodyHasCorpusAnchors,
  manuscriptTitleBlocks,
  resolvePrimaryTitleIndex
} from "../../lib/studioManuscriptView";
import {
  STUDIO_STREAM_BODY,
  STUDIO_STREAM_CURSOR,
  STUDIO_STREAM_META,
  STUDIO_STREAM_PHASE,
  STUDIO_STREAM_TITLE
} from "../../lib/studioOutputTypography";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import StudioOutputManuscript from "./StudioOutputManuscript";

function StreamCursor() {
  return <span className={STUDIO_STREAM_CURSOR} aria-hidden />;
}

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

export type StudioStreamingVariant = "idle" | "active" | "ready" | "diff";

/** Cursor 式 Agent 输出面：空稿 / 流式 / 成稿 / 改版对比 */
export default function StudioStreamingSurface({
  phase,
  taskSentence,
  blocks,
  bodyText,
  onCancel,
  variant = "active",
  version = null,
  compareBlocks = null,
  editable = false,
  onBlocksChange,
  onTitleIndexChange,
  onSelectionRevise,
  onWowRevise,
  wowReviseBusy = false,
  selectedKeys,
  changedKeys,
  onToggleKey,
  versions = [],
  activeVersionId,
  onVersionChange,
  footer,
  flowLayout = false
}: {
  phase?: string;
  taskSentence?: string;
  blocks: ManuscriptBlock[] | null;
  bodyText?: string | null;
  onCancel?: () => void;
  variant?: StudioStreamingVariant;
  version?: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[] | null;
  editable?: boolean;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onTitleIndexChange?: (index: number) => void;
  onSelectionRevise?: (selectedText: string, opinion: string) => void;
  onWowRevise?: (opinion: string) => void;
  wowReviseBusy?: boolean;
  selectedKeys?: Set<string>;
  changedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  versions?: ManuscriptVersion[];
  activeVersionId?: string;
  onVersionChange?: (versionId: string) => void;
  footer?: ReactNode;
  /** 嵌入统一滚动区：稿件与对话同屏，不再单独占满高度 */
  flowLayout?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [streamLines, setStreamLines] = useState<string[]>([]);

  const isActive = variant === "active";
  const isReadyLike = variant === "ready" || variant === "diff";
  const displayBlocks = useMemo(() => {
    if (variant === "diff" && compareBlocks) return compareBlocks;
    if (blocks?.length) return blocks;
    return version?.blocks ?? [];
  }, [variant, compareBlocks, blocks, version?.blocks]);

  const blockBody = displayBlocks.find((b) => b.kind === "body")?.text ?? "";
  const targetBody = (bodyText ?? blockBody).trim();
  const displayBody = isReadyLike ? blockBody.trim() : targetBody;
  const titles = useMemo(() => manuscriptTitleBlocks(displayBlocks), [displayBlocks]);
  const hashtags = displayBlocks.find((b) => b.kind === "hashtags");
  const cover = displayBlocks.find((b) => b.kind === "coverBrief");
  const hasContent = Boolean(displayBody || titles.length);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);

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

  useEffect(() => {
    if (flowLayout) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [displayBody, titles.length, hashtags, cover, variant, flowLayout]);

  const phaseLabel =
    phase?.trim() ||
    (variant === "idle"
      ? "输出区 · 信息足够后开始流式写稿"
      : variant === "ready"
        ? version?.label
          ? `稿件 · ${version.label}`
          : "稿件"
        : variant === "diff"
          ? "改版待确认"
          : "正在写稿…");

  const headerDot = isActive ? (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/40 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
    </span>
  ) : (
    <span
      className={[
        "inline-flex h-2 w-2 shrink-0 rounded-full",
        variant === "diff" ? "bg-brand" : "bg-line"
      ].join(" ")}
      aria-hidden
    />
  );

  return (
    <div className={flowLayout ? "w-full bg-surface" : "flex min-h-0 flex-1 flex-col bg-surface"}>
      <div
        className={[
          "flex shrink-0 items-center justify-between gap-3 border-b border-line/40 px-4 py-2.5",
          flowLayout ? "sticky top-0 z-10 bg-surface/95 backdrop-blur-sm supports-[backdrop-filter]:bg-surface/90" : ""
        ].join(" ")}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {headerDot}
          <p className={`truncate ${STUDIO_STREAM_PHASE}`}>{phaseLabel}</p>
          {variant === "ready" && versions.length > 1 && onVersionChange ? (
            <div className="ml-2 hidden min-w-0 flex-wrap items-center gap-1 sm:flex">
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={
                    v.id === activeVersionId
                      ? "rounded-md bg-fill px-2 py-0.5 text-[10px] font-medium text-ink"
                      : "rounded-md px-2 py-0.5 text-[10px] text-muted hover:bg-fill/60 hover:text-ink"
                  }
                  onClick={() => onVersionChange(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {variant === "ready" && version && displayBlocks.length ? (
            <button
              type="button"
              title="复制全部"
              aria-label="复制全部"
              className="rounded p-1.5 text-muted hover:bg-fill hover:text-ink"
              onClick={() =>
                void navigator.clipboard.writeText(manuscriptCopyAll(displayBlocks, titleIndex))
              }
            >
              <IconCopy />
            </button>
          ) : null}
          {onCancel && isActive ? (
            <button
              type="button"
              className="rounded-md border border-line/80 px-2.5 py-1 text-[11px] text-muted transition hover:bg-fill hover:text-ink"
              onClick={onCancel}
            >
              停止
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={flowLayout ? undefined : scrollRef}
        className={
          flowLayout
            ? "w-full"
            : "min-h-0 flex-1 overflow-y-auto overscroll-contain"
        }
      >
        <div
          className={[
            "mx-auto w-full max-w-2xl px-4 sm:px-6",
            flowLayout ? "py-4" : "py-5 sm:py-6"
          ].join(" ")}
        >
          {isReadyLike ? (
            <StudioOutputManuscript
              version={variant === "diff" ? null : version}
              compareBlocks={variant === "diff" ? compareBlocks : undefined}
              compareMode={variant === "diff"}
              selectedKeys={selectedKeys}
              changedKeys={changedKeys}
              onToggleKey={onToggleKey}
              onTitleIndexChange={onTitleIndexChange}
              onWowRevise={variant === "ready" ? onWowRevise : undefined}
              wowReviseBusy={wowReviseBusy}
              editable={editable && variant === "ready"}
              onBlocksChange={onBlocksChange}
              onSelectionRevise={variant === "ready" ? onSelectionRevise : undefined}
              borderless
            />
          ) : variant === "idle" && !hasContent ? (
            <div
              className={
                flowLayout
                  ? "py-2"
                  : "flex min-h-[min(42vh,360px)] flex-col justify-center"
              }
            >
              <p className={`${STUDIO_STREAM_BODY} text-ink/90`}>在这里流式写稿</p>
              <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">
                {flowLayout
                  ? "在页面底部描述主题、受众与形式。信息足够后，标题与正文会在此逐字出现；纯提问则只在对话区回复。"
                  : "在下方描述主题、受众与形式。信息足够后，标题与正文会在此逐字出现；纯提问则只在对话区回复。"}
              </p>
              {taskSentence?.trim() ? (
                <p className="mt-4 border-l-2 border-brand/20 pl-3 text-[13px] text-muted">
                  任务 · {taskSentence.trim().slice(0, 160)}
                </p>
              ) : null}
            </div>
          ) : !hasContent ? (
            <div className="space-y-4">
              {streamLines.length ? (
                <div className="space-y-1.5 border-l-2 border-brand/25 pl-3">
                  {streamLines.map((line) => (
                    <p key={line} className="text-[13px] leading-relaxed text-muted">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">准备根据你的需求撰写笔记…</p>
              )}
              <div className="space-y-2.5 pt-2" aria-hidden>
                <div className="h-5 max-w-[85%] animate-pulse rounded-md bg-fill/90" />
                <div className="h-4 max-w-full animate-pulse rounded-md bg-fill/75" />
                <div className="h-4 max-w-[92%] animate-pulse rounded-md bg-fill/60" />
                <div className="h-4 max-w-[70%] animate-pulse rounded-md bg-fill/50" />
              </div>
            </div>
          ) : (
            <article className="space-y-5">
              {streamLines.length > 1 ? (
                <div className="mb-1 space-y-0.5 border-l border-line/50 pl-2.5">
                  {streamLines.slice(-3).map((line) => (
                    <p key={line} className="text-[11px] leading-snug text-muted/90">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {titles.length > 0 ? (
                <header className="space-y-2">
                  {titles.length === 1 ? (
                    <h1 className={STUDIO_STREAM_TITLE}>{titles[0]!.text}</h1>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted">标题备选</p>
                      <div className="flex flex-wrap gap-1.5">
                        {titles.map((t, i) => (
                          <span
                            key={t.id}
                            className={[
                              "rounded-lg border px-2.5 py-1 text-xs leading-snug",
                              i === 0
                                ? "border-brand/30 bg-brand/5 text-ink"
                                : "border-line/50 bg-fill/30 text-ink/80"
                            ].join(" ")}
                          >
                            {t.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </header>
              ) : null}

              {displayBody ? (
                <section>
                  <p className={`whitespace-pre-wrap ${STUDIO_STREAM_BODY}`}>
                    {displayBody}
                    {isActive ? <StreamCursor /> : null}
                  </p>
                </section>
              ) : !titles.length && isActive ? (
                <p className={`whitespace-pre-wrap ${STUDIO_STREAM_BODY} text-muted/70`}>
                  <StreamCursor />
                </p>
              ) : null}

              {hashtags && hashtags.kind === "hashtags" && hashtags.tags.length ? (
                <p className={`opacity-90 ${STUDIO_STREAM_META}`}>
                  {hashtags.tags.map((t) => (
                    <span key={t} className="mr-2 text-brand">
                      #{t.replace(/^#/, "")}
                    </span>
                  ))}
                </p>
              ) : null}

              {cover && cover.kind === "coverBrief" && cover.text ? (
                <p className={`opacity-90 ${STUDIO_STREAM_META}`}>封面 · {cover.text}</p>
              ) : null}
            </article>
          )}
        </div>
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-line/40 px-4 py-2.5">{footer}</div>
      ) : null}
    </div>
  );
}
