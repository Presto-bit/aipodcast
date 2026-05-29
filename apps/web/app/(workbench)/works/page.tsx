"use client";

import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const PodcastWorksGallery = dynamic(() => import("../../../components/podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});
import WorksActiveJobsPanel from "../../../components/works/WorksActiveJobsPanel";
import { chipClass } from "../../../components/studio/chipStyles";
import EmptyState from "../../../components/ui/EmptyState";
import UserErrorBanner from "../../../components/ui/UserErrorBanner";
import { isTextOnlyWorkType, type WorkItem } from "../../../lib/worksTypes";
import { isAudioGalleryWorkType } from "../../../lib/workGalleryDisplay";
import { isLoggedInAccountUser, useAuth } from "../../../lib/auth";
import { useI18n } from "../../../lib/I18nContext";
import { listJobs } from "../../../lib/api";
import { countUserVisibleActiveJobs } from "../../../lib/activeJobsVisible";
import { isAbortError, usePageAbortSignal, usePageFetch } from "../../../lib/usePageAbortSignal";

const WORKS_LIMIT = 60;

function mergeById(prev: WorkItem[], next: WorkItem[]): WorkItem[] {
  const ids = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !ids.has(x.id))];
}

const ACTIVE_JOBS_LIMIT = 80;

type WorksTab = "audio" | "script" | "active";

function parseWorksTab(raw: string | null): WorksTab {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "active") return "active";
  if (t === "script") return "script";
  return "audio";
}

export default function WorksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { getAuthHeaders, ready, user } = useAuth();
  const isLoggedIn = useMemo(() => isLoggedInAccountUser(user), [user]);
  const pageAbortSignal = usePageAbortSignal();
  const pageFetch = usePageFetch(pageAbortSignal);
  const [ai, setAi] = useState<WorkItem[]>([]);
  const [tts, setTts] = useState<WorkItem[]>([]);
  const [notesBucket, setNotesBucket] = useState<WorkItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [worksView, setWorksView] = useState<WorksTab>("audio");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  /** 文稿 Tab：体裁筛选 */
  const [scriptKindFilter, setScriptKindFilter] = useState<"all" | "article" | "social">("all");

  const worksReturnTo = useMemo(() => {
    if (worksView === "active") return "/works?tab=active";
    if (worksView === "script") return "/works?tab=script";
    return "/works?tab=audio";
  }, [worksView]);

  const refreshActiveJobCount = useCallback(async () => {
    if (!ready) {
      setActiveJobCount(null);
      return;
    }
    if (!isLoggedIn) {
      setActiveJobCount(0);
      return;
    }
    try {
      const { jobs } = await listJobs({
        limit: ACTIVE_JOBS_LIMIT,
        offset: 0,
        status: "queued,running",
        slim: true
      });
      setActiveJobCount(countUserVisibleActiveJobs(jobs));
    } catch {
      setActiveJobCount(null);
    }
  }, [ready, isLoggedIn]);

  const fetchWorks = useCallback(
    async (append: boolean) => {
      setError("");
      if (append) setLoadingMore(true);
      else setLoading(true);
      const o = append ? offset : 0;
      try {
        if (!isLoggedIn) {
          if (!append) {
            setAi([]);
            setTts([]);
            setNotesBucket([]);
            setOffset(0);
            setHasMore(false);
            setActiveJobCount(0);
          }
          return;
        }
        if (!append) {
          const [res, jobsPack] = await Promise.all([
            pageFetch(`/api/works?limit=${WORKS_LIMIT}&offset=0`, {
              cache: "no-store",
              headers: { ...getAuthHeaders() }
            }),
            listJobs({
              limit: ACTIVE_JOBS_LIMIT,
              offset: 0,
              status: "queued,running",
              slim: true
            })
          ]);
          const data = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            notes?: WorkItem[];
            ai?: WorkItem[];
            tts?: WorkItem[];
            error?: string;
            detail?: string;
            total?: number;
            has_more?: boolean;
          };
          if (pageAbortSignal.aborted) return;
          if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
          setAi(Array.isArray(data.ai) ? data.ai : []);
          setTts(Array.isArray(data.tts) ? data.tts : []);
          setNotesBucket(Array.isArray(data.notes) ? data.notes : []);
          const t = typeof data.total === "number" ? data.total : (data.ai?.length || 0) + (data.tts?.length || 0);
          setOffset(t);
          setHasMore(Boolean(data.has_more));
          setActiveJobCount(
            Array.isArray(jobsPack.jobs) ? countUserVisibleActiveJobs(jobsPack.jobs) : null
          );
        } else {
          const res = await pageFetch(`/api/works?limit=${WORKS_LIMIT}&offset=${o}`, {
            cache: "no-store",
            headers: { ...getAuthHeaders() }
          });
          const data = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            notes?: WorkItem[];
            ai?: WorkItem[];
            tts?: WorkItem[];
            error?: string;
            detail?: string;
            total?: number;
            has_more?: boolean;
          };
          if (pageAbortSignal.aborted) return;
          if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
          setAi((p) => mergeById(p, Array.isArray(data.ai) ? data.ai : []));
          setTts((p) => mergeById(p, Array.isArray(data.tts) ? data.tts : []));
          setNotesBucket((p) => mergeById(p, Array.isArray(data.notes) ? data.notes : []));
          const t = typeof data.total === "number" ? data.total : (data.ai?.length || 0) + (data.tts?.length || 0);
          setOffset(o + t);
          setHasMore(Boolean(data.has_more));
        }
      } catch (err) {
        if (isAbortError(err)) return;
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        if (!pageAbortSignal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [offset, getAuthHeaders, isLoggedIn, pageAbortSignal, pageFetch]
  );

  useEffect(() => {
    if (!ready) return;
    void fetchWorks(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, getAuthHeaders, user]);

  useEffect(() => {
    setWorksView(parseWorksTab(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  useEffect(() => {
    if (worksView === "active") void refreshActiveJobCount();
  }, [worksView, refreshActiveJobCount]);

  const onActiveJobsChanged = useCallback(() => {
    setActiveJobCount((c) => (typeof c === "number" && c > 0 ? c - 1 : c));
    void refreshActiveJobCount();
  }, [refreshActiveJobCount]);

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

  const filteredAudioWorks = useMemo(
    () => audioFinishedWorks.filter(matchesFilter),
    [audioFinishedWorks, matchesFilter]
  );
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
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">我的作品</h1>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">播客音频、文稿成品与进行中任务</p>
        </div>
        {(worksView === "audio" || worksView === "script") && !loading ? (
          <p className="shrink-0 text-xs text-muted">
            已加载 <span className="font-medium tabular-nums text-ink">{totalLoaded}</span> 件
            {hasMore ? <span className="text-muted"> · 更多</span> : null}
          </p>
        ) : null}
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
        <p className="py-6 text-center text-sm text-muted">{t("common.loading")}</p>
      ) : null}

      {worksView === "audio" && !loading && emptyAudio ? (
        <EmptyState
          title="暂无音频成片"
          description="播客、语音合成等任务完成后会出现在这里；进行中的任务请查看「进行中」Tab。"
          action={
            <button
              type="button"
              className="text-sm text-brand underline"
              onClick={() => void fetchWorks(false)}
            >
              {t("common.refresh")}
            </button>
          }
        />
      ) : null}

      {worksView === "script" && !loading && emptyScript ? (
        <EmptyState
          title="暂无文稿成品"
          description="在知识库生成文章或自媒体发布稿后，会集中显示在本 Tab。"
          action={
            <button
              type="button"
              className="text-sm text-brand underline"
              onClick={() => void fetchWorks(false)}
            >
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
          onWorkDeleted={() => void fetchWorks(false)}
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
          onWorkDeleted={() => void fetchWorks(false)}
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
            onClick={() => void fetchWorks(true)}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
