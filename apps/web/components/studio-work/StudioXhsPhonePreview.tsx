"use client";

import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_TITLE
} from "../../lib/studioOutputTypography";
import {
  bodyHasCorpusAnchors,
  resolvePrimaryTitle,
  splitXhsBodyParagraphs
} from "../../lib/studioManuscriptView";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";

function CopyBtn({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      className="rounded-full border border-line/70 bg-surface px-2.5 py-1 text-[11px] text-ink hover:bg-fill"
      onClick={() => void navigator.clipboard.writeText(text)}
    >
      {label}
    </button>
  );
}

/** 小红书手机预览卡 — 产物区最底部，模拟发出去的样子 */
export default function StudioXhsPhonePreview({
  version,
  blocks,
  titleIndex
}: {
  version: ManuscriptVersion | null;
  blocks: ManuscriptBlock[];
  titleIndex: number;
}) {
  if (!blocks.length) return null;

  const title = resolvePrimaryTitle(blocks, titleIndex);
  const body = blocks.find((b) => b.kind === "body");
  const bodyText = body && body.kind === "body" ? body.text : "";
  const hashtags = blocks.find((b) => b.kind === "hashtags");
  const tags =
    hashtags && hashtags.kind === "hashtags"
      ? hashtags.tags.map((t) => t.replace(/^#/, "")).filter(Boolean)
      : [];
  const cover = blocks.find((b) => b.kind === "coverBrief");
  const coverLine = cover && cover.kind === "coverBrief" ? cover.text : title.slice(0, 14);
  const paragraphs = splitXhsBodyParagraphs(bodyText);
  const showCorpusHint = body && body.kind === "body" && (body.evidence === "corpus" || bodyHasCorpusAnchors(bodyText));

  return (
    <div className="mt-1">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted/90">发布预览</p>
      <div className="mx-auto max-w-[280px]">
        <div className="overflow-hidden rounded-[1.75rem] border border-line/80 bg-surface shadow-soft ring-1 ring-line/30">
          <div className="flex items-center justify-between bg-fill/40 px-3 py-1.5 text-[9px] text-muted">
            <span>9:41</span>
            <span>小红书</span>
            <span className="opacity-60">▮▮▮</span>
          </div>

          <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-rose-100 via-orange-50 to-amber-100 dark:from-rose-950/40 dark:via-orange-950/30 dark:to-amber-950/20">
            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              <p className="text-lg font-bold leading-snug text-ink drop-shadow-sm">{coverLine}</p>
              {title !== coverLine ? (
                <p className="mt-2 text-[11px] text-ink/70">{title.slice(0, 24)}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 px-3 py-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-brand/30 to-brand/10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-ink">你的账号</p>
                <p className="text-[9px] text-muted">刚刚</p>
              </div>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[9px] text-brand">关注</span>
            </div>

            <p className={`${STUDIO_MANUSCRIPT_TITLE} text-[15px] leading-snug`}>{title}</p>

            <div className={`space-y-2 ${STUDIO_MANUSCRIPT_BODY} text-[13px] leading-relaxed`}>
              {paragraphs.map((para) => (
                <p key={para.slice(0, 24)} className="whitespace-pre-wrap text-ink/90">
                  {para}
                </p>
              ))}
            </div>

            {showCorpusHint ? (
              <p className="text-[10px] text-brand/80">含资料锚点 · 发布前请核对事实</p>
            ) : null}

            {tags.length ? (
              <div className={`flex flex-wrap gap-1.5 ${STUDIO_MANUSCRIPT_HASHTAGS}`}>
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-brand/8 px-2 py-0.5 text-[11px] text-brand"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {version ? (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <CopyBtn label="复制标题" text={title} />
            <CopyBtn label="复制正文" text={bodyText} />
            <CopyBtn
              label="复制全部"
              text={manuscriptCopyAll(version.blocks, titleIndex)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
