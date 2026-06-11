"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import WorkbenchDynamicLoading from "../../../components/nav/WorkbenchDynamicLoading";
import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

const PodcastWorksGallery = dynamic(() => import("../../../components/podcast/PodcastWorksGallery"), {
  loading: () => (
    <WorkbenchDynamicLoading>
      <div
        className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40 p-4"
        aria-busy
        aria-label="加载作品列表"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonBlock className="h-36 rounded-2xl" />
          <SkeletonBlock className="h-36 rounded-2xl" />
          <SkeletonBlock className="h-36 rounded-2xl" />
        </div>
      </div>
    </WorkbenchDynamicLoading>
  )
});
import WorksActiveJobsPanel from "../../../components/works/WorksActiveJobsPanel";
import { chipClass } from "../../../components/studio/chipStyles";
import EmptyState from "../../../components/ui/EmptyState";
import UserErrorBanner from "../../../components/ui/UserErrorBanner";
import { isTextOnlyWorkType, type WorkItem } from "../../../lib/worksTypes";
import { isAudioGalleryWorkType, isTtsWorkType } from "../../../lib/workGalleryDisplay";
import { isLoggedInAccountUser, useAuth } from "../../../lib/auth";
import { useI18n } from "../../../lib/I18nContext";
import { WORKS_TRASH_PATH } from "../../../lib/navPaths";
import { isAbortError, usePageAbortSignal } from "../../../lib/usePageAbortSignal";
import { useActiveJobCount, useInvalidateActiveJobs } from "../../../lib/queries/activeJobsQuery";
import {
  fetchWorksPage,
  useInvalidateWorksOnMutation,
  useWorksListQuery,
  type WorksApiPayload
} from "../../../lib/queries/worksQueries";

const WORKS_LIMIT = 60;

function mergeById(prev: WorkItem[], next: WorkItem[]): WorkItem[] {
  const ids = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !ids.has(x.id))];
}

type WorksTab = "audio" | "script" | "active";

function parseWorksTab(raw: string | null): WorksTab {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "active") return "active";
  if (t === "script") return "script";
  return "audio";
}

export default function WorksPageClient({ initialWorks = null }: { initialWorks?: WorksApiPayload | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { getAuthHeaders, ready, user } = useAuth();
  const isLoggedIn = useMemo(() => isLoggedInAccountUser(user), [user]);
  const pageAbortSignal = usePageAbortSignal();
  const activeJobCount = useActiveJobCount(isLoggedIn && ready);
  const invalidateActiveJobs = useInvalidateActiveJobs();
  const invalidateWorks = useInvalidateWorksOnMutation();
  const worksQuery = useWorksListQuery(getAuthHeaders, isLoggedIn && ready, {
    limit: WORKS_LIMIT,
    offset: 0,
    initialData: initialWorks ?? undefined
  });
  const [ai, setAi] = useState<WorkItem[]>([]);
  const [tts, setTts] = useState<WorkItem[]>([]);
  const [notesBucket, setNotesBucket] = useState<WorkItem[]>([]);
  const [error, setError] = useState("");
  const [worksView, setWorksView] = useState<WorksTab>("audio");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  /** 文稿 Tab：体裁筛选 */
  const [scriptKindFilter, setScriptKindFilter] = useState<"all" | "article" | "social">("all");

  const audioKindFilter = useMemo(() => {
    const k = String(searchParams?.get("kind") || "").trim().toLowerCase();
    return k === "tts" ? ("tts" as const) : null;
  }, [searchParams]);

  useEffect(() => {
    if (!worksQuery.data) return;
    setAi(worksQuery.data.ai);
    setTts(worksQuery.data.tts);
    setNotesBucket(worksQuery.data.notes);
    const total =
      typeof worksQuery.data.total === "number"
        ? worksQuery.data.total
        : worksQuery.data.ai.length + worksQuery.data.tts.length;
    setOffset(total);
    setHasMore(Boolean(worksQuery.data.hasMore));
  }, [worksQuery.data]);

  useEffect(() => {
    if (worksQuery.error) {
      setError(worksQuery.error instanceof Error ? worksQuery.error.message : String(worksQuery.error));
    }
  }, [worksQuery.error]);

  const loading = worksQuery.isLoading && !worksQuery.data;
  const isRefreshing = worksQuery.isFetching && Boolean(worksQuery.data);

  const worksReturnTo = useMemo(() => {
    if (worksView === "active") return "/works?tab=active";
    if (worksView === "script") return "/works?tab=script";
    return "/works?tab=audio";
  }, [worksView]);

  const refreshWorks = useCallback(() => {
    setError("");
    void worksQuery.refetch();
  }, [worksQuery]);

  const fetchWorksMore = useCallback(async () => {
    if (!isLoggedIn) return;
    setError("");
    setLoadingMore(true);
    try {
      const data = await fetchWorksPage(getAuthHeaders(), { limit: WORKS_LIMIT, offset });
      if (pageAbortSignal.aborted) return;
      setAi((p) => mergeById(p, data.ai));
      setTts((p) => mergeById(p, data.tts));
      setNotesBucket((p) => mergeById(p, data.notes));
      const total =
        typeof data.total === "number" ? data.total : data.ai.length + data.tts.length;
      setOffset((o) => o + total);
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      if (isAbortError(err)) return;
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      if (!pageAbortSignal.aborted) setLoadingMore(false);
    }
  }, [getAuthHeaders, isLoggedIn, offset, pageAbortSignal]);

  useEffect(() => {
    setWorksView(parseWorksTab(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  const onActiveJobsChanged = useCallback(() => {
    invalidateActiveJobs();
  }, [invalidateActiveJobs]);

  const onWorkDeleted = useCallback(() => {
    invalidateWorks();
    refreshWorks();
  }, [invalidateWorks, refreshWorks]);

  const routeForTab = useCallback((tab: WorksTab) => {
    if (tab === "audio") return "/works?tab=audio";
    if (tab === "script") return "/works?tab=script";
    return "/works?tab=active";
  }, []);

  const audioFinishedWorks = useMemo(() => {
    const merged: WorkItem[] = [];
    const seen = new Set<string>();
    const push = (w: WorkItem) => {
      const id = String(w.id || "").trim();
      if (!id || seen.has(id)) return;
      if (isTextOnlyWorkType(String(w.type || ""))) return;
      if (!isAudioGalleryWorkType(String(w.type || ""))) return;
      seen.add(id);
      merged.push(w);
    };
    for (const w of ai) push(w);
    for (const w of tts) push(w);
    for (const w of notesBucket) push(w);
    merged.sort((a, b) => {
      const ta = new Date(String(a.createdAt || 0)).getTime();
      const tb = new Date(String(b.createdAt || 0)).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return merged;
  }, [ai, tts, notesBucket]);

  const scriptFinishedWorks = useMemo(() => {
    const merged: WorkItem[] = [];
    const seen = new Set<string>();
    const push = (w: WorkItem) => {
      const id = String(w.id || "").trim();
      if (!id || seen.has(id)) return;
      if (!isTextOnlyWorkType(String(w.type || ""))) return;
      seen.add(id);
      merged.push(w);
    };
    for (const w of ai) push(w);
    for (const w of notesBucket) push(w);
    merged.sort((a, b) => {
      const ta = new Date(String(a.createdAt || 0)).getTime();
      const tb = new Date(String(b.createdAt || 0)).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return merged;
  }, [ai, notesBucket]);

  const keyword = query.trim().toLowerCase();
  const recentThresholdMs = useMemo(() => Date.now() - 1000 * 60 * 60 * 24 * 14, []);

  const matchesFilter = useCallback(
    (w: WorkItem): boolean => {
      const title = String(w.title || w.id || "").toLowerCase();
      const excerpt = String(w.scriptText || "").toLowerCase();
      if (keyword && !title.includes(keyword) && !excerpt.includes(keyword)) return false;
      if (!recentOnly) return true;
      const ts = new Date(String(w.createdAt || "")).getTime();
      return Number.isFinite(ts) && ts >= recentThresholdMs;
    },
    [keyword, recentOnly, recentThresholdMs]
  );

  const filteredAudioWorks = useMemo(() => {
    let list = audioFinishedWorks.filter(matchesFilter);
    if (audioKindFilter === "tts") {
      list = list.filter((w) => isTtsWorkType(String(w.type || "")));
    }
    return list;
  }, [audioFinishedWorks, matchesFilter, audioKindFilter]);
  const filteredScriptWorks = useMemo(() => {
    let list = scriptFinishedWorks.filter(matchesFilter);
    if (scriptKindFilter === "article") {
      list = list.filter((w) => String(w.type || "") === "script_draft");
    } else if (scriptKindFilter === "social") {
      list = list.filter((w) => String(w.type || "") === "social_publish_draft");
    }
    return list;
  }, [scriptFinishedWorks, matchesFilter, scriptKindFilter]);

  const emptyAudio = !loading && filteredAudioWorks.length === 0;
  const emptyScript = !loading && filteredScriptWorks.length === 0;
  const totalLoaded = ai.length + tts.length + notesBucket.length;

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-8 pt-2 sm:px-4">
      <div className="mb-2 flex flex-col gap-1 border-b border-line/80 pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">{t("nav.works")}</h1>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">播客音频、文稿成品与进行中任务</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {(worksView === "audio" || worksView === "script") && (totalLoaded > 0 || isRefreshing) ? (
            <p className="text-xs text-muted">
              已加载 <span className="font-medium tabular-nums text-ink">{totalLoaded}</span> 件
              {hasMore ? <span className="text-muted"> · 更多</span> : null}
              {isRefreshing ? <span className="text-muted"> · 更新中</span> : null}
            </p>
          ) : null}
          <Link
            href={WORKS_TRASH_PATH}
            className="text-sm text-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-ink"
          >
            {t("works.trashLink")}
          </Link>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 gap-y-2">
        <button
          type="button"
          className={chipClass(worksView === "audio", "sm")}
          onClick={() => {
            setWorksView("audio");
            router.replace(routeForTab("audio"), { scroll: false });
          }}
        >
          音频
        </button>
        <button
          type="button"
          className={chipClass(worksView === "script", "sm")}
          onClick={() => {
            setWorksView("script");
            router.replace(routeForTab("script"), { scroll: false });
          }}
        >
          文稿
        </button>
        <button
          type="button"
          className={[chipClass(worksView === "active", "sm"), "inline-flex items-center"].join(" ")}
          onClick={() => {
            setWorksView("active");
            router.replace(routeForTab("active"), { scroll: false });
          }}
        >
          进行中
          {activeJobCount != null && activeJobCount > 0 ? (
            <span className="ml-1 rounded-full bg-brand/15 px-1.5 py-px text-[10px] font-medium tabular-nums text-brand">
              {activeJobCount}
            </span>
          ) : null}
        </button>
        {worksView === "audio" || worksView === "script" ? (
          <>
            <span className="hidden h-4 w-px bg-line sm:inline-block" aria-hidden />
            <input
              className="min-w-[8rem] flex-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink sm:max-w-[11rem]"
              placeholder="搜索标题或摘要…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索作品"
            />
            <button type="button" className={chipClass(recentOnly, "sm")} onClick={() => setRecentOnly((v) => !v)}>
              14 天内
            </button>
            {worksView === "script" ? (
              <>
                <span className="hidden h-4 w-px bg-line sm:inline-block" aria-hidden />
                <button
                  type="button"
                  className={chipClass(scriptKindFilter === "all", "sm")}
                  onClick={() => setScriptKindFilter("all")}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={chipClass(scriptKindFilter === "article", "sm")}
                  onClick={() => setScriptKindFilter("article")}
                >
                  文章
                </button>
                <button
                  type="button"
                  className={chipClass(scriptKindFilter === "social", "sm")}
                  onClick={() => setScriptKindFilter("social")}
                >
                  自媒体
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {worksView === "active" ? <WorksActiveJobsPanel onActiveJobsChanged={onActiveJobsChanged} /> : null}

      {(worksView === "audio" || worksView === "script") && error ? (
        <UserErrorBanner className="mb-2" message={error} onDismiss={() => setError("")} />
      ) : null}

      {(worksView === "audio" || worksView === "script") && loading ? (
        <div className="py-6" aria-busy aria-label="加载作品">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonBlock className="h-36 rounded-2xl" />
            <SkeletonBlock className="h-36 rounded-2xl" />
            <SkeletonBlock className="h-36 rounded-2xl" />
          </div>
        </div>
      ) : null}

      {worksView === "audio" && !loading && emptyAudio ? (
        <EmptyState
          title="暂无音频成片"
          description="播客、语音合成等任务完成后会出现在这里；进行中的任务请查看「进行中」Tab。"
          action={
            <button type="button" className="text-sm text-brand underline" onClick={() => refreshWorks()}>
              {t("common.refresh")}
            </button>
          }
        />
      ) : null}

      {worksView === "script" && !loading && emptyScript ? (
        <EmptyState
          title="暂无文稿成品"
          description="在资料库生成文章或自媒体发布稿后，会集中显示在本 Tab。"
          action={
            <button type="button" className="text-sm text-brand underline" onClick={() => refreshWorks()}>
              {t("common.refresh")}
            </button>
          }
        />
      ) : null}

      {worksView === "audio" && !loading && !emptyAudio ? (
        <PodcastWorksGallery
          variant="podcast"
          works={filteredAudioWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={onWorkDeleted}
          enableBatchActions
          workDetailReturnTo={worksReturnTo}
        />
      ) : null}
      {worksView === "script" && !loading && !emptyScript ? (
        <PodcastWorksGallery
          variant="notes"
          works={filteredScriptWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={onWorkDeleted}
          enableBatchActions
          workDetailReturnTo={worksReturnTo}
        />
      ) : null}

      {((worksView === "audio" && !loading && !emptyAudio) ||
        (worksView === "script" && !loading && !emptyScript)) &&
      hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill disabled:opacity-50"
            onClick={() => void fetchWorksMore()}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
