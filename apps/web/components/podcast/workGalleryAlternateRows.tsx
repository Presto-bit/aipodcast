"use client";

import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { workGalleryTypeChipLabel } from "../../lib/workGalleryDisplay";
import { buildWorkDetailHref } from "./workGalleryNav";
import { truncateByGraphemes } from "./workGalleryListShared";
import type { PodcastWorkRow } from "./workGalleryListShared";
import { useWorkGalleryListContext } from "./workGalleryListContext";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { WorkTypeIcon } from "../icons";

const SCRIPT_CARD_TITLE_MAX = 36;

function TypeChip({ w }: { w: PodcastWorkRow }) {
  return (
    <span className="inline-flex max-w-full truncate rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
      {workGalleryTypeChipLabel(w)}
    </span>
  );
}

function ActiveProgressBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/80" aria-hidden>
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
  className?: string;
};

function RowShell({ id, outer, compA11y, children, rowPlayMsg, className = "" }: RowShellProps) {
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
      className={`relative flex w-full min-w-0 max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft ${className}`.trim()}
    >
      {enableBatchActions && batchMode ? (
        <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-2 py-1 text-[10px] text-ink">
          <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
          选择
        </label>
      ) : null}
      {children}
      {renameJobId === id ? (
        <div className="border-t border-line px-2 py-1.5">
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
    syncedGenBarPct,
    rowMutationsLocked,
    rowPlayMsg
  } = props;
  const {
    menuOpenId,
    setMenuOpenId,
    menuWrapRef,
    stopBusyId,
    requestStopActiveJob,
    activeQueueCardActions,
    workDetailReturnTo
  } = useWorkGalleryListContext();
  const headlineFull = String(w.displayTitle || "").trim() || id;
  const headlineShown = truncateByGraphemes(headlineFull, SCRIPT_CARD_TITLE_MAX);
  const detailHref = buildWorkDetailHref(id, { returnTo: workDetailReturnTo, focusRead: true });

  if (inFlightQueue && activeQueueCardActions) {
    return (
      <RowShell id={id} outer={outer} compA11y={compA11y} rowPlayMsg={rowPlayMsg} className="col-span-2">
        <div className="p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <TypeChip w={w} />
              <p className="mt-1 line-clamp-1 text-xs font-semibold text-ink" title={headlineFull}>
                {headlineShown}
              </p>
              {activeSummary ? (
                <p className="mt-1 line-clamp-1 text-[10px] text-muted">{activeSummary}</p>
              ) : null}
              <ActiveProgressBar pct={syncedGenBarPct} />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-brand">{syncedGenBarPct}%</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <Link
              href={detailHref}
              className="rounded-md border border-brand/40 bg-brand/10 px-2 py-0.5 font-medium text-brand hover:bg-brand/15"
            >
              查看进度
            </Link>
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-0.5 text-ink hover:bg-fill disabled:opacity-50"
              disabled={stopBusyId === id}
              onClick={() => void requestStopActiveJob(id)}
            >
              {stopBusyId === id ? "停止中…" : "停止"}
            </button>
          </div>
        </div>
      </RowShell>
    );
  }

  return (
    <RowShell id={id} outer={outer} compA11y={compA11y} rowPlayMsg={rowPlayMsg}>
      <div className="relative min-h-[3.5rem] p-2.5">
        {!rowMutationsLocked ? (
          <div
            className="absolute right-1 top-1 z-10"
            ref={(menuOpenId === id ? menuWrapRef : undefined) as Ref<HTMLDivElement> | undefined}
          >
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-fill"
              aria-label="更多操作"
              aria-expanded={menuOpenId === id}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpenId((x) => (x === id ? null : id));
              }}
            >
              <span className="text-sm leading-none">⋯</span>
            </button>
          </div>
        ) : null}
        <Link
          href={detailHref}
          className="block min-w-0 pr-5 outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/40 rounded-md"
          aria-label={`阅读：${headlineFull}`}
        >
          <TypeChip w={w} />
          <p className="mt-1 line-clamp-1 text-xs font-semibold leading-snug text-ink" title={headlineFull}>
            {headlineShown}
          </p>
        </Link>
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
