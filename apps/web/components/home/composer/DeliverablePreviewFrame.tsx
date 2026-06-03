"use client";

import type { XhsContent, XhsCoverSpec } from "../../../lib/homeComposerExpertTypes";
import { xhsBodyPreviewLines } from "../../../lib/homeComposerExpertJob";

const DEFAULT_PALETTE = { background: "#1a1a2e", text: "#ffffff" };

function CoverMock({ cover }: { cover: XhsCoverSpec }) {
  const palette = cover.palette ?? DEFAULT_PALETTE;
  const headline = cover.headline.trim() || "封面标题";
  const subline = cover.subline?.trim();

  return (
    <div
      className="flex min-h-[42%] flex-col justify-end rounded-t-[inherit] p-4"
      style={{ background: palette.background, color: palette.text }}
    >
      <p className="text-lg font-bold leading-snug line-clamp-3">{headline}</p>
      {subline ? <p className="mt-1 text-xs opacity-80 line-clamp-2">{subline}</p> : null}
    </div>
  );
}

export default function DeliverablePreviewFrame({ content }: { content: XhsContent }) {
  const previewBody = xhsBodyPreviewLines(content.body, 5);
  const tags = content.hashtags.slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <p className="mb-2 text-center text-[11px] text-muted">笔记在信息流里的样子（示意）</p>
      <div
        className="overflow-hidden rounded-2xl border border-line/80 bg-white shadow-md dark:bg-zinc-900"
        style={{ aspectRatio: "9 / 16" }}
      >
        <div className="flex h-full flex-col">
          <CoverMock cover={content.cover} />
          <div className="flex flex-1 flex-col gap-2 overflow-hidden bg-white p-3 dark:bg-zinc-950">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200">
              {previewBody}
              {content.body.split("\n").length > 5 ? "\n…" : ""}
            </p>
            {tags.length ? (
              <div className="mt-auto flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] text-brand"
                  >
                    #{tag.replace(/^#/, "")}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted">示意排版，以平台发布页为准</p>
    </div>
  );
}
