"use client";

import { workCoverImageSrc } from "../../lib/workCoverImage";

type Props = {
  coverUrl: string;
  episodeTitle: string;
  summary: string;
  sharePageFullUrl: string;
  onCopy: () => void;
  copied: boolean;
  disabled?: boolean;
};

function IconClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinejoin="round" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  disabled
}: Props) {
  const coverSrc = workCoverImageSrc(coverUrl);
  return (
    <section className="rounded-2xl border border-line bg-fill/25 px-4 py-4">
      <h3 className="text-sm font-medium text-ink">分享链接</h3>
      <p className="mt-1 text-[11px] text-muted">打开链接即可试听，无需登录。</p>
      <div className="relative mt-4 flex gap-3 rounded-xl border border-line bg-surface p-3 pr-12 shadow-soft">
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
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-fill/40">
          {coverSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={coverSrc} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg text-muted" aria-hidden>
              🎙️
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {episodeTitle.trim() || "未命名作品"}
          </p>
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">{summary.trim() || "（无简介）"}</p>
          <p className="mt-2 truncate font-mono text-[10px] text-muted/80">{sharePageFullUrl || "—"}</p>
        </div>
      </div>
    </section>
  );
}
