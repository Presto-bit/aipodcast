"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import PodcastWorksGallery from "../../components/podcast/PodcastWorksGallery";
import WorksActiveJobsPanel from "../../components/works/WorksActiveJobsPanel";
import { chipClass } from "../../components/studio/chipStyles";
import EmptyState from "../../components/ui/EmptyState";
import type { WorkItem } from "../../lib/worksTypes";
import { useAuth } from "../../lib/auth";
import { listJobs, retryJob } from "../../lib/api";
import type { JobRecord } from "../../lib/types";

const WORKS_LIMIT = 60;

function mergeById(prev: WorkItem[], next: WorkItem[]): WorkItem[] {
  const ids = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !ids.has(x.id))];
}

const ACTIVE_JOBS_LIMIT = 80;

export default function WorksPage() {
  const router = useRouter();
  const { getAuthHeaders, ready } = useAuth();
  const [ai, setAi] = useState<WorkItem[]>([]);
  const [tts, setTts] = useState<WorkItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "podcast" | "notes" | "tts">("podcast");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** null = 尚未拉取进行中任务列表 */
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const [failedJobs, setFailedJobs] = useState<JobRecord[]>([]);
  const [failedJobsLoading, setFailedJobsLoading] = useState(false);
  const [failedJobsError, setFailedJobsError] = useState("");
  const [retryLatestBusy, setRetryLatestBusy] = useState(false);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);

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

  const refreshFailedJobs = useCallback(async () => {
    if (!ready) {
      setFailedJobs([]);
      return;
    }
    setFailedJobsLoading(true);
    setFailedJobsError("");
    try {
      const { jobs } = await listJobs({
        limit: 6,
        offset: 0,
        status: "failed",
        slim: true
      });
      setFailedJobs(jobs);
    } catch (e) {
      setFailedJobsError(String(e instanceof Error ? e.message : e));
      setFailedJobs([]);
    } finally {
      setFailedJobsLoading(false);
    }
  }, [ready]);

  const fetchWorks = useCallback(
    async (append: boolean) => {
      setError("");
      if (append) setLoadingMore(true);
      else setLoading(true);
      const o = append ? offset : 0;
      try {
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
        if (append) {
          setAi((p) => mergeById(p, nextAi));
          setTts((p) => mergeById(p, nextTts));
        } else {
          setAi(nextAi);
          setTts(nextTts);
        }
        const t = typeof data.total === "number" ? data.total : nextAi.length + nextTts.length;
        setOffset(o + t);
        setHasMore(Boolean(data.has_more));
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (!append) {
          void refreshActiveJobCount();
          void refreshFailedJobs();
        }
      }
    },
    [offset, getAuthHeaders, refreshActiveJobCount, refreshFailedJobs]
  );

  useEffect(() => {
    void fetchWorks(false);
    // 仅随登录态重载；勿依赖 fetchWorks（其含 offset，会导致分页后误触发全量刷新）
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshActiveJobCount();
  }, [refreshActiveJobCount]);

  useEffect(() => {
    void refreshFailedJobs();
  }, [refreshFailedJobs]);

  useEffect(() => {
    if (tab === "active") void refreshActiveJobCount();
  }, [tab, refreshActiveJobCount]);

  const onActiveJobsChanged = useCallback(() => {
    setActiveJobCount((c) => (typeof c === "number" && c > 0 ? c - 1 : c));
    void refreshActiveJobCount();
  }, [refreshActiveJobCount]);

  async function retryFailedJob(jobId: string) {
    setRetryBusyId(jobId);
    setFailedJobsError("");
    try {
      const next = await retryJob(jobId);
      const nextId = String(next.id || "").trim();
      void refreshFailedJobs();
      if (nextId) router.push(`/jobs/${nextId}`);
    } catch (e) {
      setFailedJobsError(String(e instanceof Error ? e.message : e));
    } finally {
      setRetryBusyId(null);
    }
  }

  async function retryLatestFailedJob() {
    const latest = failedJobs[0];
    if (!latest?.id) return;
    setRetryLatestBusy(true);
    await retryFailedJob(latest.id);
    setRetryLatestBusy(false);
  }

  const aiPodcastWorks = useMemo(
    () => ai.filter((w) => ["podcast_generate", "podcast"].includes(String(w.type || ""))),
    [ai]
  );
  const notesDraftWorks = useMemo(() => ai.filter((w) => String(w.type || "") === "script_draft"), [ai]);
  const keyword = query.trim().toLowerCase();
  const recentThresholdMs = useMemo(() => Date.now() - 1000 * 60 * 60 * 24 * 14, []);

  function matchesFilter(w: WorkItem): boolean {
    const title = String(w.title || w.id || "").toLowerCase();
    if (keyword && !title.includes(keyword)) return false;
    if (!recentOnly) return true;
    const ts = new Date(String(w.createdAt || "")).getTime();
    return Number.isFinite(ts) && ts >= recentThresholdMs;
  }

  const filteredNotesWorks = useMemo(() => notesDraftWorks.filter(matchesFilter), [notesDraftWorks, keyword, recentOnly, recentThresholdMs]);
  const filteredPodcastWorks = useMemo(() => aiPodcastWorks.filter(matchesFilter), [aiPodcastWorks, keyword, recentOnly, recentThresholdMs]);
  const filteredTtsWorks = useMemo(() => tts.filter(matchesFilter), [tts, keyword, recentOnly, recentThresholdMs]);

  const emptyAll = !loading && ai.length === 0 && tts.length === 0;
  const worksStatsPending = loading && ai.length === 0 && tts.length === 0;
  const totalLoaded = ai.length + tts.length;

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">我的作品</h1>
        <p className="mt-2 text-sm text-muted">生成完成后可在这里播放、下载、重试和继续编辑。</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
        <button type="button" className={chipClass(tab === "notes", "sm")} onClick={() => setTab("notes")}>
          笔记播客
        </button>
        <button type="button" className={chipClass(tab === "podcast", "sm")} onClick={() => setTab("podcast")}>
          AI 播客
        </button>
        <button type="button" className={chipClass(tab === "tts", "sm")} onClick={() => setTab("tts")}>
          文本转语音
        </button>
        <button type="button" className={chipClass(tab === "active", "sm")} onClick={() => setTab("active")}>
          进行中任务
        </button>
      </div>

      {tab !== "active" ? (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <input
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            placeholder="搜索作品标题或编号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={chipClass(recentOnly, "sm")}
            onClick={() => setRecentOnly((v) => !v)}
          >
            近 14 天
          </button>
        </div>
      ) : null}

      <div className="mb-6 rounded-xl border border-line bg-fill/60 px-3 py-2.5 text-xs leading-relaxed text-muted">
        <p className="font-medium text-ink">作品概览</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            总量{" "}
            <span className="font-medium tabular-nums text-ink">{worksStatsPending ? "…" : totalLoaded}</span>
            件
            {hasMore && !worksStatsPending ? <span className="ml-0.5 text-[11px]">（还可加载更多）</span> : null}
          </span>
          <span>
            笔记播客{" "}
            <span className="font-medium tabular-nums text-ink">{worksStatsPending ? "…" : notesDraftWorks.length}</span>
          </span>
          <span>
            AI 播客{" "}
            <span className="font-medium tabular-nums text-ink">{worksStatsPending ? "…" : aiPodcastWorks.length}</span>
          </span>
          <span>
            文本转语音{" "}
            <span className="font-medium tabular-nums text-ink">{worksStatsPending ? "…" : tts.length}</span>
          </span>
          <span>
            进行中{" "}
            <span className="font-medium tabular-nums text-ink">{activeJobCount === null ? "…" : activeJobCount}</span>
          </span>
        </p>
      </div>

      {tab !== "active" ? (
        <section className="mb-6 rounded-xl border border-line bg-rose-50/50 px-3 py-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-ink">失败重试</p>
              <p className="mt-1 text-muted">快速处理失败任务，减少手动排查路径。</p>
            </div>
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill disabled:opacity-50"
              disabled={retryLatestBusy || failedJobsLoading || failedJobs.length === 0}
              onClick={() => void retryLatestFailedJob()}
            >
              {retryLatestBusy ? "正在重试…" : "重试最近失败任务"}
            </button>
          </div>
          {failedJobsError ? <p className="mt-2 text-rose-700">{failedJobsError}</p> : null}
          {failedJobsLoading ? (
            <p className="mt-2 text-muted">正在加载失败任务…</p>
          ) : failedJobs.length === 0 ? (
            <p className="mt-2 text-muted">最近没有失败任务。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {failedJobs.slice(0, 3).map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-white px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{j.job_type}</p>
                    <p className="truncate text-muted">{j.id.slice(0, 8)}…</p>
                    <p className="truncate text-muted">
                      失败时间：{j.completed_at?.replace("T", " ").slice(0, 19) || j.created_at?.replace("T", " ").slice(0, 19) || "未知"}
                    </p>
                    <p className="truncate text-rose-700" title={String(j.error_message || "暂无失败原因")}>
                      原因：{String(j.error_message || "暂无失败原因").slice(0, 80)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/jobs/${j.id}`} className="text-brand hover:underline">
                      详情
                    </Link>
                    <button
                      type="button"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
                      disabled={retryBusyId === j.id}
                      onClick={() => void retryFailedJob(j.id)}
                    >
                      {retryBusyId === j.id ? "重试中…" : "重试"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "active" ? <WorksActiveJobsPanel onActiveJobsChanged={onActiveJobsChanged} /> : null}

      {tab !== "active" && error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      {tab !== "active" && loading ? (
        <p className="text-center text-sm text-muted">正在加载作品，请稍候…</p>
      ) : tab !== "active" && emptyAll ? (
        <EmptyState
          title="暂无作品"
          description="生成完成的播客与语音作品会集中在这里。"
          action={
            <button
              type="button"
              className="text-sm text-brand underline"
              onClick={() => void fetchWorks(false)}
            >
              刷新
            </button>
          }
        />
      ) : null}

      {tab !== "active" && !emptyAll && tab === "notes" ? (
        <PodcastWorksGallery
          variant="notes"
          works={filteredNotesWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={() => void fetchWorks(false)}
          enableBatchActions
        />
      ) : null}
      {tab !== "active" && !emptyAll && tab === "podcast" ? (
        <PodcastWorksGallery
          variant="podcast"
          works={filteredPodcastWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={() => void fetchWorks(false)}
          enableBatchActions
        />
      ) : null}
      {tab !== "active" && !emptyAll && tab === "tts" ? (
        <PodcastWorksGallery
          variant="tts"
          works={filteredTtsWorks}
          loading={loading}
          fetchError={error}
          onDismissError={() => setError("")}
          onWorkDeleted={() => void fetchWorks(false)}
          enableBatchActions
        />
      ) : null}

      {tab !== "active" && !loading && !emptyAll && hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
            onClick={() => void fetchWorks(true)}
          >
            {loadingMore ? "正在加载…" : "加载更多作品"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
