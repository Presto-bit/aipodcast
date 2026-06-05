"use client";

import {
  STUDIO_MANUSCRIPT_BODY,
  STUDIO_MANUSCRIPT_HASHTAGS,
  STUDIO_MANUSCRIPT_META,
  STUDIO_MANUSCRIPT_TITLE
} from "../../lib/studioOutputTypography";
import { STUDIO_WOW_REVISE_PRESETS } from "../../lib/studioWowRevise";
import {
  bodyHasCorpusAnchors,
  manuscriptTitleBlocks,
  resolvePrimaryTitleIndex
} from "../../lib/studioManuscriptView";
import type { ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";

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

/** 输出区稿件：标题备选 + 正文编辑视图 */
export default function StudioOutputManuscript({
  version,
  compareBlocks,
  compareMode,
  selectedKeys,
  changedKeys,
  onToggleKey,
  onTitleIndexChange,
  onWowRevise,
  wowReviseBusy
}: {
  version: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[] | null;
  compareMode?: boolean;
  selectedKeys?: Set<string>;
  changedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  onTitleIndexChange?: (index: number) => void;
  onWowRevise?: (opinion: string) => void;
  wowReviseBusy?: boolean;
}) {
  const blocks = compareMode && compareBlocks ? compareBlocks : version?.blocks ?? [];
  if (!blocks.length) return null;

  const titles = manuscriptTitleBlocks(blocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);
  const body = blocks.find((b) => b.kind === "body");
  const hashtags = blocks.find((b) => b.kind === "hashtags");
  const cover = blocks.find((b) => b.kind === "coverBrief");
  const showWow = !compareMode && Boolean(onWowRevise) && titles.length > 0;

  return (
    <div className="rounded-md border border-line/50 bg-fill/35 px-3 py-2.5">
      {compareMode ? (
        <p className="mb-2 text-[10px] text-muted">勾选要采纳的变更段落</p>
      ) : null}

      {titles.length > 1 && !compareMode ? (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] text-muted">标题备选（点选用于预览与复制）</p>
          <div className="flex flex-wrap gap-1.5">
            {titles.map((t, i) => (
              <button
                key={t.id}
                type="button"
                disabled={!onTitleIndexChange}
                className={[
                  "max-w-full rounded-lg border px-2.5 py-1.5 text-left text-xs leading-snug transition",
                  i === titleIndex
                    ? "border-brand/50 bg-brand/10 text-ink ring-1 ring-brand/25"
                    : "border-line/60 bg-surface text-ink/80 hover:border-line hover:bg-fill/50"
                ].join(" ")}
                onClick={() => onTitleIndexChange?.(i)}
              >
                <span className="mr-1 text-[10px] text-muted">{i + 1}</span>
                {t.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {titles.length === 1 ? (
          <section>
            {compareMode && changedKeys?.has(`title:${titles[0]!.id}`) && onToggleKey ? (
              <label className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
                <input
                  type="checkbox"
                  checked={selectedKeys?.has(`title:${titles[0]!.id}`)}
                  onChange={() => onToggleKey(`title:${titles[0]!.id}`)}
                  className="rounded border-line"
                />
                标题变更
              </label>
            ) : null}
            <p className={STUDIO_MANUSCRIPT_TITLE}>{titles[0]!.text}</p>
          </section>
        ) : null}

        {body && body.kind === "body" ? (
          <section>
            {compareMode && changedKeys?.has("body") && onToggleKey ? (
              <label className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
                <input
                  type="checkbox"
                  checked={selectedKeys?.has("body")}
                  onChange={() => onToggleKey("body")}
                  className="rounded border-line"
                />
                正文变更
              </label>
            ) : null}
            {body.evidence === "corpus" || bodyHasCorpusAnchors(body.text) ? (
              <p className="mb-1 text-[10px] text-brand/85">正文含资料锚点</p>
            ) : null}
            <p className={`whitespace-pre-wrap ${STUDIO_MANUSCRIPT_BODY}`}>{body.text}</p>
          </section>
        ) : null}

        {hashtags && hashtags.kind === "hashtags" ? (
          <p className={STUDIO_MANUSCRIPT_HASHTAGS}>
            {hashtags.tags.map((t) => (
              <span key={t} className="mr-2">
                #{t.replace(/^#/, "")}
              </span>
            ))}
          </p>
        ) : null}

        {cover && cover.kind === "coverBrief" ? (
          <p className={STUDIO_MANUSCRIPT_META}>封面：{cover.text}</p>
        ) : null}
      </div>

      {showWow ? (
        <div className="mt-3 border-t border-line/40 pt-2">
          <p className="mb-1.5 text-[10px] text-muted">惊艳重写</p>
          <div className="flex flex-wrap gap-1.5">
            {STUDIO_WOW_REVISE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={wowReviseBusy}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
                onClick={() => onWowRevise?.(preset.opinion)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {version && !compareMode ? (
        <div className="mt-2 flex justify-end border-t border-line/40 pt-2">
          <button
            type="button"
            title="复制全部（含话题）"
            aria-label="复制全部（含话题）"
            className="rounded p-1 text-muted hover:bg-fill/80 hover:text-ink"
            onClick={() =>
              void navigator.clipboard.writeText(manuscriptCopyAll(version.blocks, titleIndex))
            }
          >
            <IconCopy />
          </button>
        </div>
      ) : null}
    </div>
  );
}
