"use client";

import { cn } from "../../lib/cn";

export const AUTHOR_IP_CONTENT_TYPES = [
  { id: "article", label: "通用文章", defaultChars: 1500 },
  { id: "wechat_mp", label: "公众号", defaultChars: 2000 },
  { id: "xiaohongshu", label: "小红书", defaultChars: 900 },
  { id: "short_post", label: "短帖", defaultChars: 500 }
] as const;

export type AuthorIpContentTypeId = (typeof AUTHOR_IP_CONTENT_TYPES)[number]["id"];

export const CHAR_PRESETS: Record<string, number[]> = {
  article: [800, 1500, 2500],
  wechat_mp: [1200, 2000, 3500],
  xiaohongshu: [600, 900, 1200],
  short_post: [300, 500, 800]
};

type Props = {
  value: string;
  onChange: (id: string, defaultChars: number) => void;
  className?: string;
};

export default function AuthorIpContentTypeChips({ value, onChange, className }: Props) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {AUTHOR_IP_CONTENT_TYPES.map((ct) => (
        <button
          key={ct.id}
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === ct.id
              ? "border-brand bg-brand/10 font-medium text-brand"
              : "border-line text-muted hover:border-ink/30 hover:text-ink"
          )}
          onClick={() => onChange(ct.id, ct.defaultChars)}
        >
          {ct.label}
        </button>
      ))}
    </div>
  );
}
