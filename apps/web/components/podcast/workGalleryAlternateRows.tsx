"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { scriptExcerptFromWork, workGalleryTypeChipLabel } from "../../lib/workGalleryDisplay";
import { buildWorkDetailHref } from "./workGalleryNav";
import { NOTES_STUDIO_REF_TITLE_MAX_CHARS, truncateByGraphemes } from "./workGalleryListShared";
import type { PodcastWorkRow } from "./workGalleryListShared";
import { useWorkGalleryListContext } from "./workGalleryListContext";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { WorkTypeIcon } from "../icons";

function TypeChip({ w }: { w: PodcastWorkRow }) {
  return (
    <span className="inline-flex max-w-[10rem] shrink-0 truncate rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
      {workGalleryTypeChipLabel(w)}
    </span>
  );
}

function ActiveProgressBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line/80" aria-hidden>
      <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${p}%` }} />
    </div>
  );
}

type RowShellProps = {
  id: string;
  outer: "li" | "div";
  compA11y: Record<string, unknown>;
  children: ReactNode;
  rowPlayMsg?: string;
};

function RowShell({ id, outer, compA11y, children, rowPlayMsg }: RowShellProps) {
  const Comp = outer === "div" ? "div" : "li";
  const {
    enableBatchActions,
    batchMode,
    selectedIds,
    toggleSelect,
    renameJobId,
    renameDraft,
    setRenameDraft,
    commitRename,
    setRenameJobId
  } = useWorkGalleryListContext();
  return (
    <Comp
      key={id}
      {...compA11y}
      className="relative flex w-full min-w-0 max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
    >
      {enableBatchActions && batchMode ? (
        <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
          <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
          选择此作品
        </label>
      ) : null}
      {children}
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
          className="border-t border-danger/25 bg-danger-soft/90 px-2 py-1 text-[9px] leading-snug text-danger-ink break-words whitespace-pre-wrap"
          role="status"
        >
          {rowPlayMsg}
        </p>
      ) : null}
    </Comp>
  );
}

export type AlternateRowProps = {
  w: PodcastWorkRow;
  id: string;
  outer: "li" | "div";
  compA11y: Record<string, unknown>;
  isTextOnlyWork: boolean;
  inFlightQueue: boolean;
  isMediaInFlight: boolean;
  jobStatus: string;
  activeSummary: string;
  syncedGenBarPct: number;
  navMetaLineShown: string;
  rowMutationsLocked: boolean;
  rowPlayMsg?: string;
};

export function WorkGalleryScriptListRow(props: AlternateRowProps): ReactNode {
  const {
    w,
    id,
    outer,
    compA11y,
    inFlightQueue,
    activeSummary,
    navMetaLineShown,
    rowMutationsLocked,
    rowPlayMsg
  } = props;
  const {
    renderDownloadGated,
    zipBusy,
    openRename,
    requestDelete,
    stopBusyId,
    requestStopActiveJob,
    activeQueueCardActions,
    workDetailReturnTo,
    copyManuscriptBusyId,
    requestCopyManuscript
  } = useWorkGalleryListContext();
  const excerpt = scriptExcerptFromWork(w);
  const headlineFull = String(w.displayTitle || "").trim() || id;
  const headlineShown = truncateByGraphemes(headlineFull, NOTES_STUDIO_REF_TITLE_MAX_CHARS);
  const detailHref = buildWorkDetailHref(id, { returnTo: workDetailReturnTo, focusRead: true });
  const readLabel = rowMutationsLocked ? "查看" : "阅读";

  return (
    <RowShell id={id} outer={outer} compA11y={compA11y} rowPlayMsg={rowPlayMsg}>
      <div className="flex gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line/80 bg-fill/50">
          <WorkTypeIcon scriptDraft size={22} className="text-brand/85" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeChip w={w} />
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink line-clamp-2" title={headlineFull}>
              {headlineShown}
            </p>
          </div>
          {excerpt ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted" title={excerpt}>
              {excerpt}
            </p>
          ) : null}
          <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted" title={navMetaLineShown}>
            {inFlightQueue && activeSummary ? activeSummary : navMetaLineShown}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-fill/30 px-2 py-1.5 text-[11px]">
        {inFlightQueue && activeQueueCardActions ? (
          <>
            <Link
              href={detailHref}
              className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15"
            >
              查看进度
            </Link>
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={stopBusyId === id}
              onClick={() => void requestStopActiveJob(id)}
            >
              {stopBusyId === id ? "停止中…" : "停止"}
            </button>
            {rowMutationsLocked ? null : (
              <button
                type="button"
                className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink"
                onClick={() => requestDelete(id)}
              >
                删除
              </button>
            )}
          </>
        ) : (
          <>
            <Link
              href={detailHref}
              className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15"
            >
              {readLabel}
            </Link>
            {renderDownloadGated(
              w,
              id,
              "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-40",
              zipBusy === id ? "正在下载…" : "下载"
            )}
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={copyManuscriptBusyId === id}
              onClick={() =>
                requestCopyManuscript(id, {
                  scriptText: w.scriptText,
                  scriptCharCount: w.scriptCharCount,
                  status: w.status
                })
              }
            >
              {copyManuscriptBusyId === id ? "复制中…" : "复制全文"}
            </button>
            {rowMutationsLocked ? null : (
              <>
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                  onClick={() => openRename(id, w.displayTitle)}
                >
                  改名
                </button>
                <button
                  type="button"
                  className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink"
                  onClick={() => requestDelete(id)}
                >
                  删除
                </button>
              </>
            )}
          </>
        )}
      </div>
    </RowShell>
  );
}

export function WorkGalleryActiveRow(props: AlternateRowProps): ReactNode {
  const {
    w,
    id,
    outer,
    compA11y,
    isTextOnlyWork,
    inFlightQueue,
    isMediaInFlight,
    jobStatus,
    activeSummary,
    syncedGenBarPct,
    navMetaLineShown,
    rowMutationsLocked,
    rowPlayMsg
  } = props;
  const headlineFull = String(w.displayTitle || "").trim() || id;
  const {
    workDetailReturnTo,
    stopBusyId,
    requestStopActiveJob,
    requestDelete,
    togglePlay,
    audioLoadingId,
    activeJobId,
    isPlayingAudio
  } = useWorkGalleryListContext();
  const isPublicTpl = Boolean(w.isPodcastPublicTemplate);
  const isActive = activeJobId === id;
  const statusLabel = jobStatus === "queued" ? "排队中" : "生成中";

  return (
    <RowShell id={id} outer={outer} compA11y={compA11y} rowPlayMsg={rowPlayMsg}>
      <div className="p-3">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border border-brand/25 bg-brand/5">
            <WorkTypeIcon scriptDraft={isTextOnlyWork} size={20} className="text-brand/85" aria-hidden />
            {inFlightQueue ? (
              <span className="mt-0.5 text-[9px] font-medium tabular-nums text-brand">{syncedGenBarPct}%</span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeChip w={w} />
              <span className="rounded-md bg-fill px-1.5 py-0.5 text-[10px] font-medium text-muted">{statusLabel}</span>
            </div>
            <p className="mt-1 text-sm font-semibold leading-snug text-ink line-clamp-2" title={headlineFull}>
              {headlineFull}
            </p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">
              {activeSummary || navMetaLineShown}
            </p>
            {inFlightQueue ? <ActiveProgressBar pct={syncedGenBarPct} /> : null}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <Link
            href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
            className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15"
          >
            查看进度
          </Link>
          {!isTextOnlyWork && !isMediaInFlight ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={audioLoadingId === id}
              onClick={() =>
                void togglePlay(id, w.displayTitle, {
                  usePodcastPublicTemplateListen: isPublicTpl
                })
              }
            >
              {isActive && isPlayingAudio ? "暂停" : "试听"}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
            disabled={stopBusyId === id}
            onClick={() => void requestStopActiveJob(id)}
          >
            {stopBusyId === id ? "停止中…" : "停止"}
          </button>
          {rowMutationsLocked ? null : (
            <button
              type="button"
              className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink"
              onClick={() => requestDelete(id)}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </RowShell>
  );
}
