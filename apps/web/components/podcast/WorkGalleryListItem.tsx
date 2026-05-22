"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { unusableInsecureHttpOnHttpsPage } from "../../lib/insecureHttpOnHttpsPage";
import { computeWorkHubGeneratingBarPct } from "../../lib/workGeneratingProgressBar";
import { workCoverImageSrc } from "../../lib/workCoverImage";
import { formatWorkCreatedAtZh } from "../../lib/worksNavMetaLine";
import { buildWorkDetailHref } from "./workGalleryNav";
import {
  formatNotesStudioCardSynopsis,
  formatUnifiedWorksNavMetaLine,
  isPodcastManuscriptDraftTarget,
  NOTES_STUDIO_REF_TITLE_MAX_CHARS,
  truncateByGraphemes,
  workGalleryRowMutationsLocked,
  workIsPodcastTemplateNonOwner,
  workIsSharedNotebookForeign
} from "./workGalleryListShared";
import type { PodcastWorkRow } from "./workGalleryListShared";
import { useWorkGalleryListContext } from "./workGalleryListContext";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { IconPause, IconPlayFilled, WorkTypeIcon } from "../icons";

const WORK_GALLERY_LIST_COVER_MAX_W = 400;


function CircularPlayControl({
  playing,
  progress,
  disabled,
  onClick,
  compact
}: {
  playing: boolean;
  progress: number;
  disabled?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const r = compact ? 32 : 41;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - p);
  const wrap = compact ? "h-9 w-9" : "h-11 w-11";
  const btn = compact ? "h-6 w-6" : "h-7 w-7";
  const iconSm = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  const iconPlay = compact ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <div className={`relative inline-flex ${wrap} shrink-0 items-center justify-center`}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-line" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className="stroke-brand transition-[stroke-dashoffset]"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={playing ? "暂停" : "播放"}
        className={`relative z-[1] flex ${btn} cursor-pointer items-center justify-center rounded-full bg-surface text-brand shadow-soft outline-none ring-offset-2 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-60`}
      >
        {playing ? (
          <IconPause className={iconSm} aria-hidden />
        ) : (
          <IconPlayFilled className={`ml-px ${iconPlay}`} aria-hidden />
        )}
      </button>
    </div>
  );
}


export type WorkGalleryListItemProps = {
  w: PodcastWorkRow;
  index: number;
  outer: "li" | "div";
  eagerCoverFirstCount: number;
  useListCoverThumb: boolean;
  suppressContainerRole?: boolean;
};

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function downloadBusyLabel(workType: string | undefined): string {
  return String(workType || "") === "script_draft" ? "正在下载…" : "正在打包…";
}

function ActiveJobCoverProgressBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-1.5 bg-black/25" aria-hidden>
      <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${p}%` }} />
    </div>
  );
}

function useSyncedGeneratingBarPct(w: PodcastWorkRow, inFlightQueue: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!inFlightQueue) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [inFlightQueue, w.id, w.status, w.createdAt, w.type, w.activeJobStartedAt, w.activeJobProgress]);
  void tick;
  if (!inFlightQueue) return 0;
  return computeWorkHubGeneratingBarPct(
    {
      status: String(w.status || ""),
      jobType: String(w.type || ""),
      createdAt: String(w.createdAt || ""),
      startedAt: w.activeJobStartedAt ?? undefined,
      serverProgress:
        typeof w.activeJobProgress === "number" && Number.isFinite(w.activeJobProgress) ? w.activeJobProgress : undefined
    },
    Date.now()
  );
}

export function WorkGalleryListItem({
  w,
  index,
  outer,
  eagerCoverFirstCount,
  useListCoverThumb,
  suppressContainerRole
}: WorkGalleryListItemProps): ReactNode {
  const Comp = outer === "div" ? "div" : "li";
  const compA11y = outer === "div" && !suppressContainerRole ? ({ role: "listitem" as const } as const) : ({} as const);
  const {
    variant,
    useNotesStyleCards,
    useCompactAllLayout,
    enableBatchActions,
    batchMode,
    selectedIds,
    toggleSelect,
    pendingStudioWork,
    pendingStudioSubtitle,
    activeJobId,
    isPlayingAudio,
    activePlayError,
    playErrorById,
    progress01,
    durationSec,
    hydratedDurationSec,
    publicationsByJobId,
    menuOpenId,
    setMenuOpenId,
    menuWrapRef,
    renameJobId,
    renameDraft,
    setRenameDraft,
    commitRename,
    setRenameJobId,
    coverBustById,
    audioLoadingId,
    togglePlay,
    worksNavAuthorDisplay,
    workDetailReturnTo,
    goToSharePage,
    zipBusy,
    openRename,
    requestDelete,
    onReuseTemplate,
    renderDownloadGated,
    viewerAccountRef,
    activeQueueCardActions,
    stopBusyId,
    requestStopActiveJob
  } = useWorkGalleryListContext();

const id = w.id!;
const eagerCover = index < eagerCoverFirstCount;
const isPublicTpl = Boolean(w.isPodcastPublicTemplate);
const templateReuseArgs = isPublicTpl ? ({ publicTemplate: true } as const) : undefined;
const isScriptDraft = String(w.type || "") === "script_draft";
const jobStatus = String(w.status || "").trim();
const isMediaInFlight =
  !isScriptDraft && (jobStatus === "queued" || jobStatus === "running");
const showPendingLog =
  variant === "notes_studio" &&
  pendingStudioWork?.id === id &&
  Boolean(String(pendingStudioSubtitle || "").trim());
const isActive = activeJobId === id;
const rowPlayMsg = (isActive && activePlayError) || playErrorById[id];
const prog = isActive ? progress01 : 0;
const foreignNotebook = workIsSharedNotebookForeign(w);
const rowMutationsLocked = workGalleryRowMutationsLocked(w, viewerAccountRef);
const tplNonOwner = workIsPodcastTemplateNonOwner(w, viewerAccountRef);
const baseSec =
  typeof w.audioDurationSec === "number" && Number.isFinite(w.audioDurationSec) && w.audioDurationSec > 0
    ? w.audioDurationSec
    : hydratedDurationSec[id];
const totalSecForLabel =
  isActive && durationSec > 0 && Number.isFinite(durationSec)
    ? durationSec
    : baseSec !== undefined && Number.isFinite(baseSec)
      ? baseSec
      : undefined;
const durationLine = totalSecForLabel !== undefined ? formatClock(totalSecForLabel) : "—";
const durationCaption = isScriptDraft ? "文章出稿（无音频）" : `时长 ${durationLine}`;
const created = formatWorkCreatedAtZh(w.createdAt);
const createdShort = created;
const publications = publicationsByJobId[id] || [];
const publishedText =
  publications.length > 0
    ? `已在 ${publications.length} 处发布 · ${publications[0]?.channel_title || ""}`
    : "";
const publishActionText = publications.length > 0 ? "已发过" : "分享";
const scriptCharCountDisplay =
  typeof w.scriptCharCount === "number" &&
  Number.isFinite(w.scriptCharCount) &&
  w.scriptCharCount > 0
    ? Math.round(w.scriptCharCount)
    : null;
const reuseOrManuscriptLabel = isPodcastManuscriptDraftTarget(String(w.type || "")) ? "修改文稿" : "复用";
const inFlightQueue =
  Boolean(activeQueueCardActions) && (jobStatus === "queued" || jobStatus === "running");
const activeSummary = String(w.activeJobSummary || "").trim();
const syncedGenBarPct = useSyncedGeneratingBarPct(w, inFlightQueue);

/** 笔记本侧栏「我的作品」或首页「全部作品」紧凑列表：无封面顶栏、标题 + 元数据 + 操作（文稿在紧凑模式下仍走下方大图卡片分支） */
if (useNotesStyleCards && !(useCompactAllLayout && isScriptDraft)) {
  const headlineFull = String(w.displayTitle || "").trim() || id;
  const headlineShown = truncateByGraphemes(headlineFull, NOTES_STUDIO_REF_TITLE_MAX_CHARS);
  const metaLine = formatUnifiedWorksNavMetaLine(
    w,
    isScriptDraft,
    durationLine,
    scriptCharCountDisplay,
    createdShort,
    worksNavAuthorDisplay
  );
  const metaLineShown = inFlightQueue && activeSummary ? activeSummary : metaLine;
  const synopsisHoverFull = useCompactAllLayout
    ? `${metaLineShown}\n\n${headlineFull}`
    : `${metaLineShown}\n\n${formatNotesStudioCardSynopsis(
        w,
        isScriptDraft,
        durationLine,
        scriptCharCountDisplay,
        createdShort
      )}`;
  return (
    <Comp
      key={id}
      {...compA11y}
      className="relative flex w-full min-w-0 max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
    >
      {enableBatchActions && batchMode ? (
        <label
          className="flex items-center gap-2 border-b border-line bg-fill/40 px-2 py-1 text-[10px] text-ink"
          htmlFor={`work-gallery-batch-${id}`}
        >
          <input
            id={`work-gallery-batch-${id}`}
            name="work_gallery_batch_item"
            type="checkbox"
            checked={selectedIds.has(id)}
            onChange={() => toggleSelect(id)}
          />
          选择
        </label>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <Link
          href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
          className="block min-w-0 rounded-md outline-none ring-brand/0 transition hover:bg-fill/45 focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={`查看作品详情：${headlineFull}`}
        >
          {headlineFull !== headlineShown ? (
            <div className="group/reftitle relative min-h-0">
              <p className="line-clamp-2 min-h-0 text-[11px] font-semibold leading-tight text-ink">{headlineShown}</p>
              <div
                role="tooltip"
                className="pointer-events-none invisible absolute bottom-full left-0 z-[70] mb-1 w-max max-w-[min(18rem,90vw)] rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[10px] font-normal leading-snug text-ink opacity-0 shadow-card ring-1 ring-line/50 transition-opacity delay-[75ms] duration-100 group-hover/reftitle:visible group-hover/reftitle:opacity-100"
              >
                {headlineFull}
              </div>
            </div>
          ) : (
            <p className="line-clamp-2 min-h-0 text-[11px] font-semibold leading-tight text-ink">{headlineShown}</p>
          )}
          <div className="group/synopsis relative mt-1 min-h-0">
            <p className="line-clamp-3 min-h-0 text-[9px] leading-snug text-muted">{metaLineShown}</p>
            <div
              role="tooltip"
              className="pointer-events-none invisible absolute bottom-full left-0 z-[70] mb-1 w-max max-w-[min(18rem,92vw)] whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[9px] leading-snug text-ink opacity-0 shadow-card ring-1 ring-line/50 transition-opacity delay-[75ms] duration-100 group-hover/synopsis:visible group-hover/synopsis:opacity-100"
            >
              {synopsisHoverFull}
            </div>
          </div>
        </Link>
        {showPendingLog ? (
          <p
            className="line-clamp-5 min-h-0 text-center text-[9px] leading-snug text-brand"
            role="status"
            aria-live="polite"
          >
            {pendingStudioSubtitle.trim()}
          </p>
        ) : null}
        <div className="mt-0.5 flex items-center justify-between gap-1 border-t border-line/50 pt-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {!isScriptDraft ? (
              isMediaInFlight ? (
                <span className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border border-line/80 bg-fill/60 px-1.5 text-[9px] font-medium text-muted">
                  {jobStatus === "queued" ? "排队" : "生成"}
                </span>
              ) : (
                <CircularPlayControl
                  playing={isActive && isPlayingAudio}
                  progress={prog}
                  disabled={audioLoadingId === id}
                  onClick={() =>
                    void togglePlay(id, w.displayTitle, {
                      usePodcastPublicTemplateListen: isPublicTpl
                    })
                  }
                  compact
                />
              )
            ) : null}
          </div>
          {isMediaInFlight || rowMutationsLocked || inFlightQueue ? null : (
            <div
              className="relative shrink-0"
              ref={(menuOpenId === id ? menuWrapRef : undefined) as Ref<HTMLDivElement> | undefined}
            >
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-fill"
                aria-label="更多"
                aria-expanded={menuOpenId === id}
                onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
              >
                <span className="text-sm leading-none">⋯</span>
              </button>
            </div>
          )}
        </div>
      </div>
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
          className="border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[8px] leading-snug text-danger-ink break-words whitespace-pre-wrap"
          role="status"
        >
          {rowPlayMsg}
        </p>
      ) : null}
    </Comp>
  );
}

if (variant === "all") {
  const dayP = formatWorkCreatedAtZh(w.createdAt);
  const navMetaLine = formatUnifiedWorksNavMetaLine(
    w,
    isScriptDraft,
    durationLine,
    scriptCharCountDisplay,
    dayP,
    worksNavAuthorDisplay
  );
  const navMetaLineShown = inFlightQueue && activeSummary ? activeSummary : navMetaLine;
  return (
    <Comp
      key={id}
      {...compA11y}
      className="relative flex w-full max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
    >
      {enableBatchActions && batchMode ? (
        <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
          <input
            type="checkbox"
            checked={selectedIds.has(id)}
            onChange={() => toggleSelect(id)}
          />
          选择此作品
        </label>
      ) : null}
      <Link
        href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
        className="relative block aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t-xl bg-gradient-to-br from-fill to-fill outline-none ring-brand/0 transition hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={`查看作品详情：${w.displayTitle}`}
      >
        {w.coverImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={workCoverImageSrc(
            w.coverImage,
            coverBustById[id],
            id,
            useListCoverThumb ? { listMaxWidth: WORK_GALLERY_LIST_COVER_MAX_W } : undefined
          )}
            alt=""
            className="relative z-[1] h-full w-full object-cover"
            referrerPolicy="no-referrer"
            loading={eagerCover ? "eager" : "lazy"}
            fetchPriority={eagerCover ? "high" : "auto"}
            decoding="async"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              const orig = String(w.coverImage || "").trim();
              if (orig && el.src.includes("/api/image-proxy") && !el.dataset.fallback) {
                el.dataset.fallback = "1";
                if (unusableInsecureHttpOnHttpsPage(orig)) {
                  el.style.display = "none";
                  return;
                }
                el.src = orig;
                return;
              }
              el.style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full min-h-[3rem] flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand/[0.14] via-fill to-cta/[0.12] px-2 text-center">
            <WorkTypeIcon scriptDraft={isScriptDraft} size={28} className="text-brand/80" aria-hidden />
            <span className="text-[10px] font-medium leading-tight text-muted">
              {isScriptDraft
                ? inFlightQueue
                  ? "正文生成中…"
                  : "文稿作品"
                : inFlightQueue
                  ? "音频生成中…"
                  : "待生成或暂无封面"}
            </span>
          </div>
        )}
        {inFlightQueue ? <ActiveJobCoverProgressBar pct={syncedGenBarPct} /> : null}
      </Link>
      {isScriptDraft ? (
        <div className="shrink-0 border-b border-line/70 px-3 py-2">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink" title={w.displayTitle}>
            {w.displayTitle}
          </p>
          <p
            className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted"
            title={
              `${formatNotesStudioCardSynopsis(w, isScriptDraft, durationLine, scriptCharCountDisplay, dayP)}\n\n${navMetaLineShown}`.trim()
            }
          >
            {navMetaLineShown}
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-b border-line/70 px-3 py-2">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink line-clamp-2" title={w.displayTitle}>
              {w.displayTitle}
            </p>
            <div className="shrink-0 pt-0.5">
              {isMediaInFlight ? (
                <span className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border border-line/80 bg-fill/60 px-2 text-[10px] font-medium text-muted">
                  {jobStatus === "queued" ? "排队" : "生成中"}
                </span>
              ) : (
                <CircularPlayControl
                  playing={isActive && isPlayingAudio}
                  progress={prog}
                  disabled={audioLoadingId === id}
                  onClick={() =>
                    void togglePlay(id, w.displayTitle, {
                      usePodcastPublicTemplateListen: isPublicTpl
                    })
                  }
                  compact
                />
              )}
            </div>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted" title={navMetaLineShown}>
            {navMetaLineShown}
          </p>
        </div>
      )}
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
        {isScriptDraft ? (
          <>
            {inFlightQueue ? (
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
                disabled={stopBusyId === id}
                onClick={() => void requestStopActiveJob(id)}
              >
                {stopBusyId === id ? "停止中…" : "停止"}
              </button>
            ) : (
              renderDownloadGated(
                w,
                id,
                "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40",
                zipBusy === id ? downloadBusyLabel(w.type) : "下载"
              )
            )}
            {inFlightQueue ? (
              rowMutationsLocked ? null : (
                <button
                  type="button"
                  className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
                  onClick={() => requestDelete(id)}
                >
                  删除
                </button>
              )
            ) : (
              <Link
                href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
              >
                {rowMutationsLocked ? "查看文稿" : "修改文稿"}
              </Link>
            )}
            {rowMutationsLocked ? null : (
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                onClick={() => openRename(id, w.displayTitle)}
              >
                修改名称
              </button>
            )}
            {rowMutationsLocked || inFlightQueue ? null : (
              <button
                type="button"
                className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
                onClick={() => requestDelete(id)}
              >
                删除
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 font-medium text-ink hover:bg-fill disabled:opacity-50"
              disabled={audioLoadingId === id || isMediaInFlight}
              onClick={() =>
                void togglePlay(id, w.displayTitle, {
                  usePodcastPublicTemplateListen: isPublicTpl
                })
              }
            >
              {isMediaInFlight ? "生成中…" : isActive && isPlayingAudio ? "暂停" : "播放"}
            </button>
            {inFlightQueue ? null : (
              <button
                type="button"
                className="rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15 disabled:pointer-events-none disabled:opacity-40"
                disabled={tplNonOwner}
                title={tplNonOwner ? "模板作品仅创建者可分享发布" : undefined}
                onClick={() => goToSharePage(w)}
              >
                {publishActionText}
              </button>
            )}
            {inFlightQueue ? (
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
                disabled={stopBusyId === id}
                onClick={() => void requestStopActiveJob(id)}
              >
                {stopBusyId === id ? "停止中…" : "停止"}
              </button>
            ) : (
              renderDownloadGated(
                w,
                id,
                "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40",
                zipBusy === id ? downloadBusyLabel(w.type) : "下载"
              )
            )}
            {foreignNotebook ? null : inFlightQueue ? (
              <button
                type="button"
                className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
                onClick={() => requestDelete(id)}
              >
                删除
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                onClick={() => void onReuseTemplate(id, templateReuseArgs)}
              >
                {reuseOrManuscriptLabel}
              </button>
            )}
            {rowMutationsLocked || inFlightQueue ? null : (
              <div
                className="relative"
                ref={(menuOpenId === id ? menuWrapRef : undefined) as Ref<HTMLDivElement> | undefined}
              >
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
                  aria-label="更多"
                  onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
                >
                  <span className="text-base leading-none">⋯</span>
                </button>
              </div>
            )}
            {publications.length > 0 ? (
              <span className="ml-auto rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success-ink">
                {publishedText}
              </span>
            ) : null}
          </>
        )}
      </div>
    </Comp>
  );
}

const navMetaLineCard = formatUnifiedWorksNavMetaLine(
  w,
  isScriptDraft,
  durationLine,
  scriptCharCountDisplay,
  created,
  worksNavAuthorDisplay
);
const navMetaLineCardShown = inFlightQueue && activeSummary ? activeSummary : navMetaLineCard;
const scriptCardMetaTitle = isScriptDraft
  ? `${formatNotesStudioCardSynopsis(w, isScriptDraft, durationLine, scriptCharCountDisplay, created)}\n\n${navMetaLineCardShown}`
  : "";

return (
  <Comp
    key={id}
    {...compA11y}
    className="relative flex w-full max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
  >
    {enableBatchActions && batchMode ? (
      <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
        <input
          type="checkbox"
          checked={selectedIds.has(id)}
          onChange={() => toggleSelect(id)}
        />
        选择此作品
      </label>
    ) : null}
    <Link
      href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
      className="relative block aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-gradient-to-br from-fill to-fill outline-none ring-brand/0 transition hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-brand"
      aria-label={`查看作品详情：${w.displayTitle}`}
    >
      {w.coverImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={workCoverImageSrc(
            w.coverImage,
            coverBustById[id],
            id,
            useListCoverThumb ? { listMaxWidth: WORK_GALLERY_LIST_COVER_MAX_W } : undefined
          )}
          alt=""
          className="relative z-[1] h-full w-full object-cover"
          referrerPolicy="no-referrer"
          loading={eagerCover ? "eager" : "lazy"}
          fetchPriority={eagerCover ? "high" : "auto"}
          decoding="async"
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            const orig = String(w.coverImage || "").trim();
            if (orig && el.src.includes("/api/image-proxy") && !el.dataset.fallback) {
              el.dataset.fallback = "1";
              if (unusableInsecureHttpOnHttpsPage(orig)) {
                el.style.display = "none";
                return;
              }
              el.src = orig;
              return;
            }
            el.style.display = "none";
          }}
        />
      ) : (
        <div className="flex h-full min-h-[3rem] flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand/[0.14] via-fill to-cta/[0.12] px-2 text-center">
          <WorkTypeIcon scriptDraft={isScriptDraft} size={28} className="text-brand/80" aria-hidden />
          <span className="text-[10px] font-medium leading-tight text-muted">
            {isScriptDraft
              ? inFlightQueue
                ? "正文生成中…"
                : "文稿作品"
              : inFlightQueue
                ? "音频生成中…"
                : "待生成或暂无封面"}
          </span>
        </div>
      )}
      {inFlightQueue ? <ActiveJobCoverProgressBar pct={syncedGenBarPct} /> : null}
    </Link>

    {isScriptDraft ? (
      <div className="shrink-0 border-t border-line/70 px-3 py-2">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink" title={w.displayTitle}>
          {w.displayTitle}
        </p>
        <p
          className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted"
          title={scriptCardMetaTitle.trim()}
        >
          {navMetaLineCardShown}
        </p>
      </div>
    ) : (
      <div className="flex min-h-[4.25rem] shrink-0 flex-row items-center gap-2 border-t border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-ink" title={w.displayTitle}>
            {w.displayTitle}
          </p>
          <p className="mt-1 truncate text-xs text-muted" title={durationCaption}>
            {durationCaption}
          </p>
          {scriptCharCountDisplay !== null ? (
            <p
              className="mt-0.5 truncate text-[11px] tabular-nums text-muted"
              title={`正文约 ${scriptCharCountDisplay.toLocaleString()} 字`}
            >
              约 {scriptCharCountDisplay.toLocaleString()} 字
            </p>
          ) : null}
          <p className="mt-0.5 truncate text-[11px] text-muted" title={created}>
            {created}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0">
          {isMediaInFlight ? (
            <span className="inline-flex h-11 min-w-[2.75rem] items-center justify-center rounded-full border border-line/80 bg-fill/60 px-2 text-[10px] font-medium text-muted">
              {jobStatus === "queued" ? "排队" : "生成中"}
            </span>
          ) : (
            <CircularPlayControl
              playing={isActive && isPlayingAudio}
              progress={prog}
              disabled={audioLoadingId === id}
              onClick={() =>
                void togglePlay(id, w.displayTitle, {
                  usePodcastPublicTemplateListen: isPublicTpl
                })
              }
            />
          )}
          {rowMutationsLocked || inFlightQueue ? null : (
            <div
              className="relative"
              ref={(menuOpenId === id ? menuWrapRef : undefined) as Ref<HTMLDivElement> | undefined}
            >
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
                aria-label="更多"
                onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
              >
                <span className="text-base leading-none">⋯</span>
              </button>
            </div>
          )}
        </div>
      </div>
    )}
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
      {isScriptDraft ? (
        <>
          {inFlightQueue ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={stopBusyId === id}
              onClick={() => void requestStopActiveJob(id)}
            >
              {stopBusyId === id ? "停止中…" : "停止"}
            </button>
          ) : (
            renderDownloadGated(
              w,
              id,
              "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40",
              zipBusy === id ? downloadBusyLabel(w.type) : "下载"
            )
          )}
          {inFlightQueue ? (
            rowMutationsLocked ? null : (
              <button
                type="button"
                className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
                onClick={() => requestDelete(id)}
              >
                删除
              </button>
            )
          ) : (
            <Link
              href={buildWorkDetailHref(id, { returnTo: workDetailReturnTo })}
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
            >
              {rowMutationsLocked ? "查看文稿" : "修改文稿"}
            </Link>
          )}
          {rowMutationsLocked ? null : (
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
              onClick={() => openRename(id, w.displayTitle)}
            >
              修改名称
            </button>
          )}
          {rowMutationsLocked || inFlightQueue ? null : (
            <button
              type="button"
              className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
              onClick={() => requestDelete(id)}
            >
              删除
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-2 py-1 font-medium text-ink hover:bg-fill disabled:opacity-50"
            disabled={audioLoadingId === id || isMediaInFlight}
            onClick={() =>
              void togglePlay(id, w.displayTitle, {
                usePodcastPublicTemplateListen: isPublicTpl
              })
            }
          >
            {isMediaInFlight ? "生成中…" : isActive && isPlayingAudio ? "暂停" : "播放"}
          </button>
          {inFlightQueue ? null : (
            <button
              type="button"
              className="rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15 disabled:pointer-events-none disabled:opacity-40"
              disabled={tplNonOwner}
              title={tplNonOwner ? "模板作品仅创建者可分享发布" : undefined}
              onClick={() => goToSharePage(w)}
            >
              {publishActionText}
            </button>
          )}
          {inFlightQueue ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={stopBusyId === id}
              onClick={() => void requestStopActiveJob(id)}
            >
              {stopBusyId === id ? "停止中…" : "停止"}
            </button>
          ) : (
            renderDownloadGated(
              w,
              id,
              "rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40",
              zipBusy === id ? downloadBusyLabel(w.type) : "下载"
            )
          )}
          {foreignNotebook ? null : inFlightQueue ? (
            <button
              type="button"
              className="rounded-md border border-danger/35 bg-danger-soft/50 px-2 py-1 text-danger-ink hover:bg-danger-soft/80"
              onClick={() => requestDelete(id)}
            >
              删除
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
              onClick={() => void onReuseTemplate(id, templateReuseArgs)}
            >
              {reuseOrManuscriptLabel}
            </button>
          )}
          {publications.length > 0 ? (
            <span className="ml-auto rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success-ink">
              {publishedText}
            </span>
          ) : null}
        </>
      )}
    </div>
  </Comp>
);
}
