"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
import { manuscriptTitleBlocks } from "../../lib/studioManuscriptView";
import {
  STUDIO_STREAM_BODY,
  STUDIO_STREAM_CURSOR,
  STUDIO_STREAM_META,
  STUDIO_STREAM_PHASE,
  STUDIO_STREAM_TITLE
} from "../../lib/studioOutputTypography";
import type { ManuscriptBlock } from "../../lib/studioWorkTypes";

function StreamCursor() {
  return (
    <span
      className={STUDIO_STREAM_CURSOR}
      aria-hidden
    />
  );
}

/** Cursor 式流式写作面：单栏、进度条、正文增量、闪烁光标 */
export default function StudioStreamingSurface({
  phase,
  taskSentence,
  blocks,
  bodyText,
  onCancel
}: {
  phase?: string;
  taskSentence?: string;
  blocks: ManuscriptBlock[] | null;
  /** SSE body_delta 优先于 blocks 内 body */
  bodyText?: string | null;
  onCancel?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [streamLines, setStreamLines] = useState<string[]>([]);

  const blockBody = blocks?.find((b) => b.kind === "body")?.text ?? "";
  const targetBody = (bodyText ?? blockBody).trim();
  const displayBody = targetBody;
  const titles = useMemo(() => manuscriptTitleBlocks(blocks ?? []), [blocks]);
  const hashtags = blocks?.find((b) => b.kind === "hashtags");
  const cover = blocks?.find((b) => b.kind === "coverBrief");
  const hasContent = Boolean(displayBody || titles.length);

  useEffect(() => {
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
  }, [phase, taskSentence]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [displayBody, titles.length, hashtags, cover]);

  const phaseLabel = phase?.trim() || "正在写稿…";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/40 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/40 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <p className={`truncate ${STUDIO_STREAM_PHASE}`}>{phaseLabel}</p>
        </div>
        {onCancel ? (
          <button
            type="button"
            className="shrink-0 rounded-md border border-line/80 px-2.5 py-1 text-[11px] text-muted transition hover:bg-fill hover:text-ink"
            onClick={onCancel}
          >
            停止
          </button>
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-6">
          {!hasContent ? (
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
                    <StreamCursor />
                  </p>
                </section>
              ) : !titles.length ? (
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
                <p className={`opacity-90 ${STUDIO_STREAM_META}`}>
                  封面 · {cover.text}
                </p>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
