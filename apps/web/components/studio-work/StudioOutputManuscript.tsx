"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { phaseToGenerateStreamLine } from "../../lib/studioGenerateStream";
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

function cloneBlocks(blocks: ManuscriptBlock[]): ManuscriptBlock[] {
  return blocks.map((b) => {
    if (b.kind === "hashtags") return { ...b, tags: [...b.tags] };
    return { ...b };
  });
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
  wowReviseBusy,
  editable = false,
  onBlocksChange,
  onSelectionRevise,
  generatingPhase,
  generatingTask,
  borderless = false
}: {
  version: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[] | null;
  compareMode?: boolean;
  /** 写稿中：在输出区展示进度与文字占位（非预览） */
  generatingPhase?: string;
  /** 写稿中：展示当前任务句，组成输出流 */
  generatingTask?: string;
  selectedKeys?: Set<string>;
  changedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  onTitleIndexChange?: (index: number) => void;
  onWowRevise?: (opinion: string) => void;
  wowReviseBusy?: boolean;
  editable?: boolean;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onSelectionRevise?: (selectedText: string, opinion: string) => void;
  /** 嵌入流式写作面时去掉外层卡片 */
  borderless?: boolean;
}) {
  const sourceBlocks = compareMode && compareBlocks ? compareBlocks : version?.blocks ?? [];
  const [draftBlocks, setDraftBlocks] = useState<ManuscriptBlock[]>(() => cloneBlocks(sourceBlocks));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodySectionRef = useRef<HTMLElement | null>(null);
  const [selectionUi, setSelectionUi] = useState<{ text: string } | null>(null);
  const [selectionOpinion, setSelectionOpinion] = useState("");
  const [streamLines, setStreamLines] = useState<string[]>([]);

  useEffect(() => {
    setDraftBlocks(cloneBlocks(sourceBlocks));
  }, [version?.id, compareMode, compareBlocks]);

  useEffect(() => {
    if (!generatingPhase) {
      setStreamLines([]);
      return;
    }
    const taskLine = generatingTask?.trim()
      ? `任务：${generatingTask.trim().slice(0, 160)}`
      : null;
    const phaseLine = phaseToGenerateStreamLine(generatingPhase);
    setStreamLines((prev) => {
      const next = [...prev];
      if (taskLine && !next.includes(taskLine)) next.unshift(taskLine);
      if (!next.includes(phaseLine)) next.push(phaseLine);
      return next;
    });
  }, [generatingPhase, generatingTask]);

  const scheduleSave = useCallback(
    (next: ManuscriptBlock[]) => {
      if (!editable || !onBlocksChange) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => onBlocksChange(next), 500);
    },
    [editable, onBlocksChange]
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  if (generatingPhase) {
    const label = generatingPhase.trim() || "写稿中…";
    return (
      <div className="rounded-md border border-line/50 bg-fill/35 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
          <span>{label}</span>
        </div>
        {streamLines.length ? (
          <div className="mt-3 space-y-1.5 border-t border-line/30 pt-2">
            {streamLines.map((line) => (
              <p key={line} className={`text-sm leading-relaxed text-ink/85 ${STUDIO_MANUSCRIPT_BODY}`}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
        <div className="mt-3 space-y-2" aria-hidden>
          <div className={`h-4 animate-pulse rounded bg-fill/80`} />
          <div className={`h-3 animate-pulse rounded bg-fill/70`} />
          <div className={`h-3 w-[94%] animate-pulse rounded bg-fill/60`} />
        </div>
      </div>
    );
  }

  const blocks = editable && !compareMode ? draftBlocks : sourceBlocks;
  if (!blocks.length) return null;

  const titles = manuscriptTitleBlocks(blocks);
  const titleIndex = resolvePrimaryTitleIndex(version, titles.length);
  const body = blocks.find((b) => b.kind === "body");
  const hashtags = blocks.find((b) => b.kind === "hashtags");
  const cover = blocks.find((b) => b.kind === "coverBrief");
  const showWow = !compareMode && Boolean(onWowRevise) && titles.length > 0;

  function patchBlock(nextBlock: ManuscriptBlock) {
    const next = draftBlocks.map((b) => {
      if (b.kind === nextBlock.kind && (b.kind !== "title" || b.id === nextBlock.id)) {
        return nextBlock;
      }
      return b;
    });
    setDraftBlocks(next);
    scheduleSave(next);
  }

  function onBodySelection() {
    if (!onSelectionRevise || compareMode) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || text.length < 4) {
      setSelectionUi(null);
      return;
    }
    const anchor = bodySectionRef.current;
    if (!anchor || !sel?.anchorNode || !anchor.contains(sel.anchorNode)) {
      setSelectionUi(null);
      return;
    }
    setSelectionUi({ text });
    setSelectionOpinion("");
  }

  return (
    <div
      className={
        borderless ? "min-w-0" : "rounded-md border border-line/50 bg-fill/35 px-3 py-2.5"
      }
    >
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
                {editable ? (
                  <input
                    className="w-full min-w-[8rem] border-0 bg-transparent p-0 text-xs text-ink outline-none"
                    value={t.text}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchBlock({ ...t, text: e.target.value })}
                  />
                ) : (
                  t.text
                )}
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
            {editable && !compareMode ? (
              <textarea
                className={`w-full resize-none border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_TITLE}`}
                rows={2}
                value={titles[0]!.text}
                onChange={(e) => patchBlock({ ...titles[0]!, text: e.target.value })}
              />
            ) : (
              <p className={STUDIO_MANUSCRIPT_TITLE}>{titles[0]!.text}</p>
            )}
          </section>
        ) : null}

        {body && body.kind === "body" ? (
          <section ref={bodySectionRef} onMouseUp={onBodySelection}>
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
            {editable && !compareMode ? (
              <textarea
                className={`w-full resize-y border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_BODY}`}
                rows={8}
                value={body.text}
                onChange={(e) => patchBlock({ ...body, text: e.target.value })}
              />
            ) : (
              <p className={`whitespace-pre-wrap ${STUDIO_MANUSCRIPT_BODY}`}>{body.text}</p>
            )}
            {selectionUi && onSelectionRevise ? (
              <div className="mt-2 rounded-lg border border-line/60 bg-surface px-2.5 py-2 shadow-soft">
                <p className="mb-1 text-[10px] text-muted">优化选中片段</p>
                <input
                  className="mb-2 w-full rounded-md border border-line/60 bg-fill/30 px-2 py-1 text-xs text-ink outline-none"
                  placeholder="例如：更口语、保留数据"
                  value={selectionOpinion}
                  onChange={(e) => setSelectionOpinion(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-brand px-2 py-1 text-[11px] text-brand-foreground"
                    onClick={() => {
                      onSelectionRevise(selectionUi.text, selectionOpinion);
                      setSelectionUi(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                  >
                    优化这段
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line px-2 py-1 text-[11px] text-muted"
                    onClick={() => setSelectionUi(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {hashtags && hashtags.kind === "hashtags" ? (
          editable && !compareMode ? (
            <input
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_HASHTAGS}`}
              value={hashtags.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
              onChange={(e) => {
                const tags = e.target.value
                  .split(/[\s,#]+/)
                  .map((t) => t.replace(/^#/, "").trim())
                  .filter(Boolean);
                patchBlock({ ...hashtags, tags });
              }}
            />
          ) : (
            <p className={STUDIO_MANUSCRIPT_HASHTAGS}>
              {hashtags.tags.map((t) => (
                <span key={t} className="mr-2">
                  #{t.replace(/^#/, "")}
                </span>
              ))}
            </p>
          )
        ) : null}

        {cover && cover.kind === "coverBrief" ? (
          editable && !compareMode ? (
            <input
              className={`w-full border-0 bg-transparent p-0 outline-none ${STUDIO_MANUSCRIPT_META}`}
              value={cover.text}
              onChange={(e) => patchBlock({ ...cover, text: e.target.value })}
            />
          ) : (
            <p className={STUDIO_MANUSCRIPT_META}>封面：{cover.text}</p>
          )
        ) : null}
      </div>

      {showWow ? (
        <div className="mt-3 border-t border-line/40 pt-2">
          <p className="mb-1.5 text-[10px] text-muted">优化调整</p>
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
              void navigator.clipboard.writeText(manuscriptCopyAll(blocks, titleIndex))
            }
          >
            <IconCopy />
          </button>
        </div>
      ) : null}
    </div>
  );
}
