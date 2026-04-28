"use client";

import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const PodcastWorksGallery = dynamic(() => import("../../components/podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});
import WorksActiveJobsPanel from "../../components/works/WorksActiveJobsPanel";
import { chipClass } from "../../components/studio/chipStyles";
import EmptyState from "../../components/ui/EmptyState";
import type { WorkItem } from "../../lib/worksTypes";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import { listJobs } from "../../lib/api";

const WORKS_LIMIT = 60;

function mergeById(prev: WorkItem[], next: WorkItem[]): WorkItem[] {
  const ids = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !ids.has(x.id))];
}

const ACTIVE_JOBS_LIMIT = 80;

export default function WorksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { getAuthHeaders, ready } = useAuth();
  const [ai, setAi] = useState<WorkItem[]>([]);
  const [tts, setTts] = useState<WorkItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  /** 音频 / 文稿为已结束成品；进行中为队列任务 */
  const [worksView, setWorksView] = useState<"audio" | "script" | "active">("audio");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);

  const refreshActiveJobCount = useCallback(async () => {
    if (!ready) {
      setActiveJobCount(null);
      return;
    }
    try {
      const { jobs } = await listJobs({
        limit: ACTIVE_JOBS_LIMIT,
        offset: 0,
        status: "queued,running",
        slim: true
      });
      setActiveJobCount(jobs.length);
    } catch {
      setActiveJobCount(null);
    }
  }, [ready]);

  const fetchWorks = useCallback(
    async (append: boolean) => {
      setError("");
      if (append) setLoadingMore(true);
      else setLoading(true);
      const o = append ? offset : 0;
      try {
        if (!append) {
          const [res, jobsPack] = await Promise.all([
            fetch(`/api/works?limit=${WORKS_LIMIT}&offset=0`, {
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
          if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
          const nextAi = Array.isArray(data.ai) ? data.ai : [];
          const nextTts = Array.isArray(data.tts) ? data.tts : [];
          setAi(nextAi);
          setTts(nextTts);
          const t = typeof data.total === "number" ? data.total : nextAi.length + nextTts.length;
          setOffset(t);
          setHasMore(Boolean(data.has_more));
          setActiveJobCount(Array.isArray(jobsPack.jobs) ? jobsPack.jobs.length : null);
        } else {
          const res = await fetch(`/api/works?limit=${WORKS_LIMIT}&offset=${o}`, {
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
          if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
          const nextAi = Array.isArray(data.ai) ? data.ai : [];
          const nextTts = Array.isArray(data.tts) ? data.tts : [];
          setAi((p) => mergeById(p, nextAi));
          setTts((p) => mergeById(p, nextTts));
          const t = typeof data.total === "number" ? data.total : nextAi.length + nextTts.length;
          setOffset(o + t);
          setHasMore(Boolean(data.has_more));
        }
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [offset, getAuthHeaders]
  );

  useEffect(() => {
    if (!ready) return;
    void fetchWorks(false);
    // 仅随登录态刷新全表；勿依赖 fetchWorks/offset，否则会「加载更多」后重复首屏请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, getAuthHeaders]);

  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t === "active") {
      setWorksView("active");
    } else {
      setWorksView((v) => (v === "active" ? "audio" : v));
    }
  }, [searchParams]);

  useEffect(() => {
    if (worksView === "active") void refreshActiveJobCount();
  }, [worksView, refreshActiveJobCount]);

  const onActiveJobsChanged = useCallback(() => {
    setActiveJobCount((c) => (typeof c === "number" && c > 0 ? c - 1 : c));
    void refreshActiveJobCount();
  }, [refreshActiveJobCount]);

  const aiPodcastWorks = useMemo(
    () =>
      ai.filter((w) =>
        ["podcast_generate", "podcast"].includes(String(w.type || ""))
      ),
    [ai]
  );
  const notesDraftWorks = useMemo(() => ai.filter((w) => String(w.type || "") === "script_draft"), [ai]);
  const keyword = query.trim().toLowerCase();
  const recentThresholdMs = useMemo(() => Date.now() - 1000 * 60 * 60 * 24 * 14, []);

  const matchesFilter = useCallback(
    (w: WorkItem): boolean => {
      const title = String(w.title || w.id || "").toLowerCase();
      if (keyword && !title.includes(keyword)) return false;
      if (!recentOnly) return true;
      const ts = new Date(String(w.createdAt || "")).getTime();
      return Number.isFinite(ts) && ts >= recentThresholdMs;
    },
    [keyword, recentOnly, recentThresholdMs]
  );

  const filteredNotesWorks = useMemo(() => notesDraftWorks.filter(matchesFilter), [notesDraftWorks, matchesFilter]);
  const audioFinishedWorks = useMemo(() => {
    const merged = [...aiPodcastWorks, ...tts];
    merged.sort((a, b) => {
      const ta = new Date(String(a.createdAt || 0)).getTime();
      const tb = new Date(String(b.createdAt || 0)).getTime();
      const na = Number.isFinite(ta) ? ta : 0;
      const nb = Number.isFinite(tb) ? tb : 0;
      return nb - na;
    });
    return merged;
  }, [aiPodcastWorks, tts]);
  const filteredAudioFinishedWorks = useMemo(
    () => audioFinishedWorks.filter(matchesFilter),
    [audioFinishedWorks, matchesFilter]
  );

  const emptyAll = !loading && ai.length === 0 && tts.length === 0;
  const totalLoaded = ai.length + tts.length;

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-8 pt-2 sm:px-4">
      <div className="mb-2 flex flex-col gap-1 border-b border-line/80 pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">我的作品</h1>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">成品与进行中任务</p>
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
            router.replace("/works", { scroll: false });
          }}
        >
          音频
        </button>
        <button
          type="button"
          className={chipClass(worksView === "script", "sm")}
          onClick={() => {
            setWorksView("script");
            router.replace("/works", { scroll: false });
          }}
        >
          文稿
        </button>
        <button
          type="button"
          className={[chipClass(worksView === "active", "sm"), "inline-flex items-center"].join(" ")}
          onClick={() => {
            setWorksView("active");
            router.replace("/works?tab=active", { scroll: false });
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
              placeholder="搜索标题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索作品"
            />
            <button type="button" className={chipClass(recentOnly, "sm")} onClick={() => setRecentOnly((v) => !v)}>
              14 天内
            </button>
          </>
        ) : null}
      </div>

      {worksView === "active" ? <WorksActiveJobsPanel onActiveJobsChanged={onActiveJobsChanged} /> : null}

      {(worksView === "audio" || worksView === "script") && error ? (
        <p className="mb-2 text-sm text-danger-ink">{error}</p>
      ) : null}

      {(worksView === "audio" || worksView === "script") && loading ? (
        <p className="py-6 text-center text-sm text-muted">{t("common.loading")}</p>
      ) : (worksView === "audio" || worksView === "script") && emptyAll ? (
        <EmptyState
          title={t("empty.worksFinished.title")}
          description={t("empty.worksFinished.desc")}
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

      {worksView === "audio" && !emptyAll ? (
        <PodcastWorksGallery
          variant="all"
          works={filteredAudioFinishedWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={() => void fetchWorks(false)}
          enableBatchActions
          plainDownloadGate
        />
      ) : null}
      {worksView === "script" && !emptyAll ? (
        <PodcastWorksGallery
          variant="notes"
          works={filteredNotesWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={() => void fetchWorks(false)}
          enableBatchActions
          plainDownloadGate
        />
      ) : null}

      {(worksView === "audio" || worksView === "script") && !loading && !emptyAll && hasMore ? (
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
