"use client";

import Link from "next/link";
import { memo, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import {
  scriptCardPreviewFromWork,
  scriptCardMetaLine,
  scriptCharCountForWork,
  scriptSourceNoteLine
} from "../../lib/scriptCardPreview";
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

const SOURCE_LINE_CLASS = "line-clamp-1 min-w-0 truncate text-[10px]";
const SOURCE_SLOT_CLASS = "mt-1 min-h-[1.125rem]";

function ScriptCardFooter({
  detailHref,
  id,
  w,
  mini,
  rowMutationsLocked,
  copyManuscriptBusyId,
  requestCopyManuscript,
  menuOpenId,
  setMenuOpenId,
  menuWrapRef
}: {
  detailHref: string;
  id: string;
  w: PodcastWorkRow;
  mini: boolean;
  rowMutationsLocked: boolean;
  copyManuscriptBusyId: string | null;
  requestCopyManuscript: (jobId: string, work: PodcastWorkRow) => void;
  menuOpenId: string | null;
  setMenuOpenId: Dispatch<SetStateAction<string | null>>;
  menuWrapRef: Ref<HTMLDivElement | null>;
}) {
  return (
    <div
      className={`mt-auto flex shrink-0 items-center gap-1.5 border-t border-line bg-fill/30 ${
        mini ? "min-h-[2rem] border-line/60 bg-fill/25 px-1.5 py-1 text-[10px]" : "min-h-[2.5rem] px-2 py-1.5 text-[11px]"
      }`}
    >
      <Link
        href={detailHref}
        className={
          mini
            ? "rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-medium text-brand hover:bg-brand/15"
            : "rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15"
        }
      >
        阅读
      </Link>
      <button
        type="button"
        className={
          mini
            ? "rounded border border-line bg-surface px-1.5 py-0.5 text-ink hover:bg-fill disabled:opacity-50"
            : "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
        }
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
            className={`flex items-center justify-center rounded-full text-muted hover:bg-fill ${
              mini ? "h-6 w-6" : "h-7 w-7"
            }`}
            aria-label="更多"
            aria-expanded={menuOpenId === id}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpenId((x) => (x === id ? null : id));
            }}
          >
            <span className={mini ? "text-sm leading-none" : "text-base leading-none"}>⋯</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
  const previewMax = mini ? 48 : 100;
  const rowMutationsLocked = workGalleryRowMutationsLocked(w, viewerAccountRef);
  const rowPlayMsg = playErrorById[id];

  const title = String(w.displayTitle || "").trim() || id;
  const preview =
    scriptCardPreviewFromWork(w, previewMax) || "暂无摘要，点击预览或进入详情阅读。";
  const charCount = scriptCharCountForWork(w);
  const created = formatWorkCreatedAtZh(w.createdAt);
  const metaLine = scriptCardMetaLine(w, created);
  const source = scriptSourceNoteLine(w);
  const detailHref = buildWorkDetailHref(id, {
    returnTo: workDetailReturnTo,
    focusRead: true
  });

  const sourceLine = source ? (
    source.notebookHref ? (
      <Link
        href={source.notebookHref}
        className={`${SOURCE_LINE_CLASS} text-brand hover:underline`}
        title={source.title}
        onClick={(e) => e.stopPropagation()}
      >
        📎 {source.text}
      </Link>
    ) : (
      <p className={`${SOURCE_LINE_CLASS} text-brand/90`} title={source.title}>
        📎 {source.text}
      </p>
    )
  ) : null;

  if (mini) {
    return (
      <Comp
        key={id}
        {...compA11y}
        className="relative flex h-full w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft"
      >
        <button
          type="button"
          className="block w-full shrink-0 cursor-pointer text-left outline-none ring-brand/0 focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={`预览：${title}`}
          onClick={() => openQuickRead(w)}
        >
          <ScriptDynamicCover
            jobId={id}
            title={title}
            jobType={w.type}
            charCount={charCount}
            workProgramName={w.workProgramName}
            density="mini"
            className="rounded-t-lg"
          />
        </button>
        <div className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            className="block w-full min-w-0 flex-1 px-2 py-1.5 text-left"
            onClick={() => openQuickRead(w)}
          >
            <p
              className="line-clamp-1 min-h-[1.375rem] text-[11px] font-semibold leading-snug text-ink"
              title={title}
            >
              {title}
            </p>
            <p className="mt-0.5 line-clamp-1 min-h-[1.125rem] text-[9px] leading-snug text-muted" title={preview}>
              {preview}
            </p>
            <div className={SOURCE_SLOT_CLASS}>{sourceLine}</div>
            <p className="mt-0.5 line-clamp-1 min-h-[1.125rem] text-[9px] text-muted" title={metaLine || undefined}>
              {metaLine || "\u00a0"}
            </p>
          </button>
          <ScriptCardFooter
            detailHref={detailHref}
            id={id}
            w={w}
            mini
            rowMutationsLocked={rowMutationsLocked}
            copyManuscriptBusyId={copyManuscriptBusyId}
            requestCopyManuscript={requestCopyManuscript}
            menuOpenId={menuOpenId}
            setMenuOpenId={setMenuOpenId}
            menuWrapRef={menuWrapRef}
          />
        </div>
        {rowPlayMsg ? (
          <p className="border-t border-danger/25 bg-danger-soft/90 px-1.5 py-0.5 text-[8px] text-danger-ink" role="status">
            {rowPlayMsg}
          </p>
        ) : null}
      </Comp>
    );
  }

  return (
    <Comp
      key={id}
      {...compA11y}
      className="relative flex h-full w-full max-w-full flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-soft"
    >
      {enableBatchActions && batchMode ? (
        <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
          <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
          选择此作品
        </label>
      ) : null}

      <button
        type="button"
        className="block w-full shrink-0 cursor-pointer rounded-t-xl text-left outline-none ring-brand/0 focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={`预览：${title}`}
        onClick={() => openQuickRead(w)}
      >
        <ScriptDynamicCover
          jobId={id}
          title={title}
          jobType={w.type}
          charCount={charCount}
          workProgramName={w.workProgramName}
          density="full"
          className="rounded-t-xl"
        />
      </button>

      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          className="block w-full min-w-0 flex-1 px-3 py-2 text-left outline-none transition-colors hover:opacity-90"
          onClick={() => openQuickRead(w)}
        >
          <p className="line-clamp-2 min-h-[2.75rem] text-sm font-semibold leading-snug text-ink" title={title}>
            {title}
          </p>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[10px] leading-relaxed text-muted" title={preview}>
            {preview}
          </p>
          <div className={SOURCE_SLOT_CLASS}>{sourceLine}</div>
          <p className="mt-1 line-clamp-1 min-h-[1.125rem] text-[10px] text-muted" title={metaLine || undefined}>
            {metaLine || "\u00a0"}
          </p>
        </button>

        {renameJobId === id ? (
          <div className="shrink-0 border-t border-line px-3 py-2">
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
            className="shrink-0 border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[9px] leading-snug text-danger-ink break-words whitespace-pre-wrap"
            role="status"
          >
            {rowPlayMsg}
          </p>
        ) : null}

        <ScriptCardFooter
          detailHref={detailHref}
          id={id}
          w={w}
          mini={false}
          rowMutationsLocked={rowMutationsLocked}
          copyManuscriptBusyId={copyManuscriptBusyId}
          requestCopyManuscript={requestCopyManuscript}
          menuOpenId={menuOpenId}
          setMenuOpenId={setMenuOpenId}
          menuWrapRef={menuWrapRef}
        />
      </div>
    </Comp>
  );
});
