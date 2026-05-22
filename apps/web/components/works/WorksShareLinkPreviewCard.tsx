"use client";

import { workCoverImageSrc } from "../../lib/workCoverImage";
import { IconCheck, IconClipboard, IconWorkPodcast } from "../icons";

type Props = {
  coverUrl: string;
  episodeTitle: string;
  summary: string;
  sharePageFullUrl: string;
  onCopy: () => void;
  copied: boolean;
  disabled?: boolean;
  /** 仅链接一行 + 复制（作品详情「发布」页已与预览区信息重复时用） */
  compact?: boolean;
};

/**
 * 听众端分享卡片预览 + 复制链接（用于作品详情「发布」分组）。
 */
export function WorksShareLinkPreviewCard({
  coverUrl,
  episodeTitle,
  summary,
  sharePageFullUrl,
  onCopy,
  copied,
  disabled,
  compact
}: Props) {
  const coverSrc = workCoverImageSrc(coverUrl);
  if (compact) {
    return (
      <section className="relative rounded-2xl border border-line bg-surface py-3 pr-12 pl-3 shadow-soft">
        <button
          type="button"
          disabled={disabled || !sharePageFullUrl}
          onClick={() => void onCopy()}
          className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-line bg-fill/50 text-ink shadow-sm hover:bg-fill disabled:opacity-40"
          title={copied ? "已复制" : "复制链接"}
          aria-label={copied ? "已复制" : "复制链接"}
        >
          {copied ? <IconCheck className="h-4 w-4 text-success-ink" /> : <IconClipboard className="h-4 w-4 text-muted" />}
        </button>
        <p className="truncate font-mono text-[11px] leading-relaxed text-muted/90">{sharePageFullUrl || "—"}</p>
      </section>
    );
  }
  return (
    <section className="relative flex gap-3 rounded-2xl border border-line bg-surface p-3 pr-12 shadow-soft">
      <button
        type="button"
        disabled={disabled || !sharePageFullUrl}
        onClick={() => void onCopy()}
        className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-fill/50 text-ink shadow-sm hover:bg-fill disabled:opacity-40"
        title={copied ? "已复制" : "复制链接"}
        aria-label={copied ? "已复制" : "复制链接"}
      >
        {copied ? <IconCheck className="h-4 w-4 text-success-ink" /> : <IconClipboard className="h-4 w-4 text-muted" />}
      </button>
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-fill/40">
        {coverSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={coverSrc} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted" aria-hidden>
            <IconWorkPodcast width={28} height={28} className="opacity-70" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{episodeTitle.trim() || "未命名作品"}</p>
        <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">{summary.trim() || "（无简介）"}</p>
        <p className="mt-2 truncate font-mono text-[10px] text-muted/80">{sharePageFullUrl || "—"}</p>
      </div>
    </section>
  );
}
