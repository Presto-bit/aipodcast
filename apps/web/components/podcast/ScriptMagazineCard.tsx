"use client";

import Link from "next/link";
import { memo, type ReactNode, type Ref } from "react";
import {
  formatScriptCharCountLabel,
  scriptCardPreviewFromWork,
  scriptCharCountForWork,
  scriptSourceNoteLine
} from "../../lib/scriptCardPreview";
import { workGalleryTypeChipLabel } from "../../lib/workGalleryDisplay";
import { formatWorkCreatedAtZh } from "../../lib/worksNavMetaLine";
import { buildWorkDetailHref } from "./workGalleryNav";
import type { PodcastWorkRow } from "./workGalleryListShared";
import { workGalleryRowMutationsLocked } from "./workGalleryListShared";
import { useWorkGalleryListContext } from "./workGalleryListContext";
import { ScriptDynamicCover } from "./ScriptDynamicCover";
import InlineTextPrompt from "../ui/InlineTextPrompt";

export type ScriptMagazineCardProps = {
  w: PodcastWorkRow;
  id: string;
  outer: "li" | "div";
  compA11y: Record<string, unknown>;
};

export const ScriptMagazineCard = memo(function ScriptMagazineCard({
  w,
  id,
  outer,
  compA11y
}: ScriptMagazineCardProps): ReactNode {
  const Comp = outer === "div" ? "div" : "li";
  const {
    scriptCardDensity,
    enableBatchActions,
    batchMode,
    selectedIds,
    toggleSelect,
    menuOpenId,
    setMenuOpenId,
    menuWrapRef,
    renameJobId,
    renameDraft,
    setRenameDraft,
    commitRename,
    setRenameJobId,
    workDetailReturnTo,
    openQuickRead,
    requestCopyManuscript,
    copyManuscriptBusyId,
    viewerAccountRef,
    playErrorById
  } = useWorkGalleryListContext();

  const mini = scriptCardDensity === "mini";
  const previewMax = mini ? 60 : 100;
  const previewClamp = mini ? "line-clamp-1" : "line-clamp-2";
  const rowMutationsLocked = workGalleryRowMutationsLocked(w, viewerAccountRef);
  const rowPlayMsg = playErrorById[id];

  const title = String(w.displayTitle || "").trim() || id;
  const preview =
    scriptCardPreviewFromWork(w, previewMax) || "暂无摘要，点击预览或进入详情阅读。";
  const charCount = scriptCharCountForWork(w);
  const charLabel = formatScriptCharCountLabel(charCount);
  const created = formatWorkCreatedAtZh(w.createdAt);
  const source = scriptSourceNoteLine(w);
  const program = String(w.workProgramName || "").trim();
  const programShown = program ? workGalleryTypeChipLabel(w) : "";
  const detailHref = buildWorkDetailHref(id, {
    returnTo: workDetailReturnTo,
    focusRead: true
  });

  return (
    <Comp
      key={id}
      {...compA11y}
      className="relative flex w-full max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
    >
      {enableBatchActions && batchMode ? (
        <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
          <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
          选择此作品
        </label>
      ) : null}

      <button
        type="button"
        className="block w-full cursor-pointer rounded-t-xl text-left outline-none ring-brand/0 focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={`预览：${title}`}
        onClick={() => openQuickRead(w)}
      >
        <ScriptDynamicCover
          jobId={id}
          title={title}
          jobType={w.type}
          charCount={charCount}
          density={mini ? "mini" : "full"}
          className="rounded-t-xl"
        />
      </button>

      <div className={`shrink-0 border-b border-line/70 ${mini ? "px-2.5 py-2" : "px-3 py-2"}`}>
        <button
          type="button"
          className="block w-full min-w-0 text-left outline-none transition-colors hover:opacity-90"
          onClick={() => openQuickRead(w)}
        >
          <div className="flex flex-wrap items-center gap-1">
            {programShown && programShown !== (w.type === "social_publish_draft" ? "自媒体" : "文章") ? (
              <span className="rounded bg-fill/80 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {programShown}
              </span>
            ) : null}
            {charLabel && mini ? (
              <span className="text-[10px] tabular-nums text-muted">{charLabel}</span>
            ) : null}
          </div>
          <p
            className={`${mini ? "text-xs" : "text-sm"} line-clamp-2 font-semibold leading-snug text-ink`}
            title={title}
          >
            {title}
          </p>
          <p className={`mt-1 ${previewClamp} text-[10px] leading-relaxed text-muted`} title={preview}>
            {preview}
          </p>
          {source ? (
            source.notebookHref ? (
              <Link
                href={source.notebookHref}
                className={`mt-1 block ${previewClamp} text-[10px] text-brand hover:underline`}
                title={source.title}
                onClick={(e) => e.stopPropagation()}
              >
                📎 {source.text}
              </Link>
            ) : (
              <p className={`mt-1 ${previewClamp} text-[10px] text-brand/90`} title={source.title}>
                📎 {source.text}
              </p>
            )
          ) : null}
          {created !== "—" ? <p className="mt-1 text-[10px] text-muted">{created}</p> : null}
        </button>
      </div>

      {renameJobId === id ? (
        <div className="border-t border-line px-3 py-2">
          <InlineTextPrompt
            open
            title="作品名称"
            value={renameDraft}
            onChange={setRenameDraft}
            onSubmit={commitRename}
            onCancel={() => setRenameJobId(null)}
            placeholder="输入显示名称"
          />
        </div>
      ) : null}

      {rowPlayMsg ? (
        <p
          className="border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[9px] leading-snug text-danger-ink break-words whitespace-pre-wrap"
          role="status"
        >
          {rowPlayMsg}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-fill/30 px-2 py-1.5 text-[11px]">
        <Link
          href={detailHref}
          className="rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15"
        >
          阅读
        </Link>
        <button
          type="button"
          className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
          disabled={copyManuscriptBusyId === id}
          onClick={() => requestCopyManuscript(id, w)}
        >
          {copyManuscriptBusyId === id ? "复制中…" : "复制"}
        </button>
        {rowMutationsLocked ? null : (
          <div
            className="relative ml-auto"
            ref={(menuOpenId === id ? menuWrapRef : undefined) as Ref<HTMLDivElement> | undefined}
          >
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
              aria-label="更多"
              aria-expanded={menuOpenId === id}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenId((x) => (x === id ? null : id));
              }}
            >
              <span className="text-base leading-none">⋯</span>
            </button>
          </div>
        )}
      </div>
    </Comp>
  );
});
