"use client";

import dynamic from "next/dynamic";

const ShowNotesMarkdownDoc = dynamic(() => import("./ShowNotesMarkdownDoc"), {
  ssr: false,
  loading: () => <p className="my-1 text-xs text-muted">预览加载中…</p>
});

type Props = {
  markdown: string;
  /** 点击 `[文案](t:秒)` 时跳转播放器；未提供则时间戳为纯链接样式（不可点） */
  onSeekSeconds?: (sec: number) => void;
  className?: string;
};

/**
 * Show Notes 预览：GFM Markdown + `[显示](t:123)` 时间戳（秒）跳转；标题层级用于章节结构。
 */
export function ShowNotesMarkdownPreview({ markdown, onSeekSeconds, className }: Props) {
  const baseClass =
    "max-h-48 overflow-y-auto rounded-lg border border-line bg-fill/40 px-2 py-2 text-sm text-ink [&_a]:text-brand [&_a]:underline [&_button]:text-left [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1";
  return (
    <div className={className ? `${baseClass} ${className}` : baseClass}>
      <ShowNotesMarkdownDoc markdown={markdown} onSeekSeconds={onSeekSeconds} />
    </div>
  );
}
