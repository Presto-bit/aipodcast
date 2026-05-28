"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { WorkItem } from "../../lib/worksTypes";
import { isTextOnlyWorkType } from "../../lib/worksTypes";
import { sortWorksByRecency, splitWorksByGalleryKind, buildWorksTabHref } from "../../lib/workGalleryDisplay";

const PodcastWorksGallery = dynamic(() => import("../podcast/PodcastWorksGallery"), {
  loading: () => (
    <div className="min-h-[72px] rounded-xl border border-line/50 bg-fill/40" aria-busy aria-label="加载作品" />
  )
});

type Props = {
  works: WorkItem[];
  loading: boolean;
  fetchError: string;
  onDismissError: () => void;
  onWorkDeleted: () => void;
  /** 详情返回路径，如 /home、/create、/notes */
  returnTo: string;
  /** 每组最多展示条数；0 表示不限制 */
  maxPerGroup?: number;
  pendingStudioWork?: WorkItem | null;
  pendingStudioSubtitle?: string;
  emptyHint?: string;
};

function worksTabHref(tab: "audio" | "script" | "active", returnTo: string): string {
  return buildWorksTabHref(tab, returnTo);
}

function WorksGroup({
  title,
  works,
  viewAllHref,
  loading,
  fetchError,
  onDismissError,
  onWorkDeleted,
  returnTo,
  maxPerGroup,
  pendingStudioWork,
  pendingStudioSubtitle,
  galleryVariant
}: {
  title: string;
  works: WorkItem[];
  viewAllHref: string;
  loading: boolean;
  fetchError: string;
  onDismissError: () => void;
  onWorkDeleted: () => void;
  returnTo: string;
  maxPerGroup: number;
  pendingStudioWork?: WorkItem | null;
  pendingStudioSubtitle?: string;
  galleryVariant: "notes_studio" | "podcast" | "notes";
}) {
  if (!loading && works.length === 0 && !pendingStudioWork) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted">{title}</h3>
        <Link href={viewAllHref} className="shrink-0 text-[11px] font-medium text-brand hover:underline">
          查看全部
        </Link>
      </div>
      <PodcastWorksGallery
        variant={galleryVariant}
        works={works}
        loading={loading}
        fetchError={fetchError}
        onDismissError={onDismissError}
        onWorkDeleted={onWorkDeleted}
        sidebarMaxItems={maxPerGroup > 0 ? maxPerGroup : undefined}
        pendingStudioWork={pendingStudioWork}
        pendingStudioSubtitle={pendingStudioSubtitle}
        workDetailReturnTo={returnTo}
      />
    </section>
  );
}

/**
 * 按播客 / 文稿分组展示作品（知识库、首页、创作页共用）。
 */
export default function WorksGroupedGalleryPanel({
  works,
  loading,
  fetchError,
  onDismissError,
  onWorkDeleted,
  returnTo,
  maxPerGroup = 3,
  pendingStudioWork = null,
  pendingStudioSubtitle = "",
  emptyHint = "暂无成片；生成播客或文章后将显示在这里。"
}: Props) {
  const { audio, script } = useMemo(() => {
    const split = splitWorksByGalleryKind(works);
    return {
      audio: sortWorksByRecency(split.audio),
      script: sortWorksByRecency(split.script)
    };
  }, [works]);

  const pendingIsScript = pendingStudioWork ? isTextOnlyWorkType(String(pendingStudioWork.type || "")) : false;
  const cap = maxPerGroup > 0 ? maxPerGroup : 0;
  const empty = !loading && audio.length === 0 && script.length === 0 && !pendingStudioWork;

  if (empty && !fetchError) {
    return <p className="py-4 text-center text-xs text-muted">{emptyHint}</p>;
  }

  return (
    <div className="space-y-4">
      {pendingStudioWork && !pendingIsScript ? (
        <WorksGroup
          title="进行中"
          works={[]}
          viewAllHref={worksTabHref("active", returnTo)}
          loading={loading}
          fetchError=""
          onDismissError={onDismissError}
          onWorkDeleted={onWorkDeleted}
          returnTo={returnTo}
          maxPerGroup={cap}
          pendingStudioWork={pendingStudioWork}
          pendingStudioSubtitle={pendingStudioSubtitle}
          galleryVariant="notes_studio"
        />
      ) : null}
      <WorksGroup
        title={`播客${audio.length > 0 ? `（${audio.length}）` : ""}`}
        works={audio}
        viewAllHref={worksTabHref("audio", returnTo)}
        loading={loading}
        fetchError={fetchError}
        onDismissError={onDismissError}
        onWorkDeleted={onWorkDeleted}
        returnTo={returnTo}
        maxPerGroup={cap}
        galleryVariant="notes_studio"
      />
      <WorksGroup
        title={`文稿${script.length > 0 ? `（${script.length}）` : ""}`}
        works={script}
        viewAllHref={worksTabHref("script", returnTo)}
        loading={loading}
        fetchError={fetchError}
        onDismissError={onDismissError}
        onWorkDeleted={onWorkDeleted}
        returnTo={returnTo}
        maxPerGroup={cap}
        pendingStudioWork={pendingIsScript ? pendingStudioWork : null}
        pendingStudioSubtitle={pendingIsScript ? pendingStudioSubtitle : ""}
        galleryVariant="notes"
      />
    </div>
  );
}
