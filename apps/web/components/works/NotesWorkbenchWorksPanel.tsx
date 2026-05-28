"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { WorkItem } from "../../lib/worksTypes";
import { isTextOnlyWorkType } from "../../lib/worksTypes";
import {
  buildWorksTabHref,
  inferPreferredWorksGalleryTab,
  sortWorksByRecency,
  splitWorksByGalleryKind,
  type WorksGalleryTab
} from "../../lib/workGalleryDisplay";
import { chipClass } from "../studio/chipStyles";

const PodcastWorksGallery = dynamic(() => import("../podcast/PodcastWorksGallery"), {
  loading: () => (
    <div className="min-h-[72px] rounded-xl border border-line/50 bg-fill/40" aria-busy aria-label="加载作品" />
  )
});

const ACTIVE_STATUSES = new Set(["running", "queued", "processing", "pending"]);
const MAX_ITEMS = 6;

type Props = {
  works: WorkItem[];
  loading: boolean;
  fetchError: string;
  onDismissError: () => void;
  onWorkDeleted: () => void;
  pendingStudioWork?: WorkItem | null;
  pendingStudioSubtitle?: string;
};

function workIsInFlight(work: WorkItem): boolean {
  return ACTIVE_STATUSES.has(String(work.status || "").trim().toLowerCase());
}

function limitedWorks(list: WorkItem[], max: number): WorkItem[] {
  return list.length > max ? list.slice(0, max) : list;
}

function mergeActiveWorks(inFlight: WorkItem[], pending: WorkItem | null | undefined): WorkItem[] {
  const map = new Map<string, WorkItem>();
  if (pending?.id) map.set(String(pending.id), pending);
  for (const w of inFlight) {
    const id = String(w.id || "").trim();
    if (id && !map.has(id)) map.set(id, w);
  }
  return sortWorksByRecency([...map.values()]);
}

/**
 * 知识库「我的作品」：音频 / 文章 / 进行中 Tab；音频用封面卡片，文章用文稿列表。
 */
export default function NotesWorkbenchWorksPanel({
  works,
  loading,
  fetchError,
  onDismissError,
  onWorkDeleted,
  pendingStudioWork = null,
  pendingStudioSubtitle = ""
}: Props) {
  const { audio, script, finishedAudio, finishedScript, activeWorks } = useMemo(() => {
    const split = splitWorksByGalleryKind(works);
    const inFlight = works.filter(workIsInFlight);
    return {
      audio: sortWorksByRecency(split.audio),
      script: sortWorksByRecency(split.script),
      finishedAudio: sortWorksByRecency(split.audio.filter((w) => !workIsInFlight(w))),
      finishedScript: sortWorksByRecency(split.script.filter((w) => !workIsInFlight(w))),
      activeWorks: mergeActiveWorks(inFlight, pendingStudioWork)
    };
  }, [works, pendingStudioWork]);

  const preferredTab = useMemo(
    () => inferPreferredWorksGalleryTab({ works, pendingStudioWork }),
    [works, pendingStudioWork]
  );
  const [tab, setTab] = useState<WorksGalleryTab>(preferredTab);
  const [tabTouched, setTabTouched] = useState(false);

  useEffect(() => {
    if (tabTouched || loading) return;
    setTab(preferredTab);
  }, [preferredTab, tabTouched, loading]);

  useEffect(() => {
    if (!pendingStudioWork || !workIsInFlight(pendingStudioWork)) return;
    setTab("active");
  }, [pendingStudioWork?.id, pendingStudioWork?.status]);

  const activeCount = activeWorks.length;
  const emptyHint =
    tab === "audio"
      ? "暂无与本笔记本关联的播客成片。"
      : tab === "script"
        ? "暂无与本笔记本关联的文章或自媒体稿。"
        : "当前没有进行中的生成任务。";

  const showGallery =
    tab === "active"
      ? activeCount > 0 || loading
      : tab === "audio"
        ? finishedAudio.length > 0 || loading
        : finishedScript.length > 0 || loading || Boolean(pendingStudioWork && isTextOnlyWorkType(String(pendingStudioWork.type || "")));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="作品类型">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "audio"}
            className={chipClass(tab === "audio")}
            onClick={() => {
              setTabTouched(true);
              setTab("audio");
            }}
          >
            音频{audio.length > 0 ? ` ${audio.length}` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "script"}
            className={chipClass(tab === "script")}
            onClick={() => {
              setTabTouched(true);
              setTab("script");
            }}
          >
            文章{script.length > 0 ? ` ${script.length}` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={chipClass(tab === "active")}
            onClick={() => {
              setTabTouched(true);
              setTab("active");
            }}
          >
            进行中{activeCount > 0 ? ` ${activeCount}` : ""}
          </button>
        </div>
        <Link
          href={buildWorksTabHref(tab, "/notes")}
          className="shrink-0 text-[11px] font-medium text-brand hover:underline"
        >
          查看全部
        </Link>
      </div>

      {!loading && !showGallery && !fetchError ? (
        <p className="py-4 text-center text-xs text-muted">{emptyHint}</p>
      ) : null}

      {tab === "audio" && showGallery ? (
        <PodcastWorksGallery
          variant="podcast"
          works={limitedWorks(finishedAudio, MAX_ITEMS)}
          loading={loading}
          fetchError={fetchError}
          onDismissError={onDismissError}
          onWorkDeleted={onWorkDeleted}
          sidebarMaxItems={MAX_ITEMS}
          workDetailReturnTo="/notes"
        />
      ) : null}

      {tab === "script" && showGallery ? (
        <PodcastWorksGallery
          variant="notes"
          works={limitedWorks(finishedScript, MAX_ITEMS)}
          loading={loading}
          fetchError={fetchError}
          onDismissError={onDismissError}
          onWorkDeleted={onWorkDeleted}
          sidebarMaxItems={MAX_ITEMS}
          pendingStudioWork={
            pendingStudioWork && isTextOnlyWorkType(String(pendingStudioWork.type || "")) ? pendingStudioWork : null
          }
          pendingStudioSubtitle={pendingStudioSubtitle}
          workDetailReturnTo="/notes"
        />
      ) : null}

      {tab === "active" && showGallery ? (
        <PodcastWorksGallery
          variant="podcast"
          works={limitedWorks(activeWorks, MAX_ITEMS)}
          loading={loading}
          fetchError={fetchError}
          onDismissError={onDismissError}
          onWorkDeleted={onWorkDeleted}
          sidebarMaxItems={MAX_ITEMS}
          activeQueueCardActions
          workDetailReturnTo="/notes"
        />
      ) : null}
    </div>
  );
}
