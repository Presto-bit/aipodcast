"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { cancelJob, listJobs, purgeJob } from "../../lib/api";
import { jobsListLoadErrorPresentation } from "../../lib/jobsListErrors";
import type { JobRecord, JobStatus } from "../../lib/types";
import { useI18n } from "../../lib/I18nContext";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";

const PAGE_SIZE = 40;

function statusBadge(status: string) {
  const m: Record<string, string> = {
    queued: "bg-track text-ink",
    running: "bg-fill text-brand",
    succeeded: "bg-success-soft text-success-ink",
    failed: "bg-danger-soft text-danger-ink",
    cancelled: "bg-warning-soft text-warning-ink"
  };
  return m[status] || "bg-track text-ink";
}

/** 任务耗时：已结束用 started→completed；排队/运行中用起点→当前时间。 */
function formatJobDuration(j: JobRecord): string {
  const startMs = j.started_at
    ? new Date(j.started_at).getTime()
    : new Date(j.created_at || 0).getTime();
  if (!Number.isFinite(startMs)) return "—";

  const endRaw = j.completed_at ? new Date(j.completed_at).getTime() : NaN;
  const hasCompletedAt = Number.isFinite(endRaw);

  const formatSeconds = (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  if (hasCompletedAt) {
    const ms = Math.max(0, endRaw - startMs);
    if (ms < 1000) return "<1s";
    const sec = Math.round(ms / 1000);
    if (sec < 120) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const rs = sec % 60;
    return rs ? `${m}分${rs}秒` : `${m}分钟`;
  }

  if (j.status === "queued" || j.status === "running") {
    return `${formatSeconds((Date.now() - startMs) / 1000)}…`;
  }

  return "—";
}

/** 列表接口 creator_label（用户名/手机等）+ created_by 回退 */
function jobCreatorDisplayName(j: JobRecord): string {
  const label = String(j.creator_label ?? "").trim();
  if (label) return label;
  const raw = String(j.created_by ?? "").trim();
  return raw || "—";
}

/** 已成功任务：是否提供成片入口（作品页或后台详情） */
function succeededContentPeekKinds(j: JobRecord): { audio: boolean; article: boolean } | null {
  if (j.status !== "succeeded") return null;
  const jt = String(j.job_type || "");
  if (jt === "script_draft") return { audio: false, article: true };
  if (jt === "podcast_generate" || jt === "podcast") return { audio: true, article: true };
  if (jt === "tts" || jt === "text_to_speech") return { audio: true, article: false };
  return null;
}

/** 成品页链接：用户进作品页；管理员进后台任务详情成品区 */
function succeededContentPeekHref(j: JobRecord, isAdmin: boolean): string | null {
  if (!succeededContentPeekKinds(j)) return null;
  const id = encodeURIComponent(j.id);
  return isAdmin ? `/admin/jobs/${id}` : `/works/${id}`;
}

export type JobsListViewVariant = "public" | "admin";

type JobsListViewProps = {
  variant: JobsListViewVariant;
};

/** 创作记录列表（站内 / 管理后台复用） */
export default function JobsListView({ variant }: JobsListViewProps) {
  const { t } = useI18n();
  const basePath = variant === "admin" ? "/admin/jobs" : "/jobs";
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [filter, setFilter] = useState<JobStatus | "">("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);

  const copyJobId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedJobId(id);
      window.setTimeout(() => {
        setCopiedJobId((cur) => (cur === id ? null : cur));
      }, 2000);
    } catch {
      window.prompt("复制以下任务 ID：", id);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { jobs: list, hasMore: more } = await listJobs({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: filter || undefined
      });
      setJobs(list);
      setHasMore(more);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds([]);
  }, [filter, page]);

  const errPresentation = useMemo(() => {
    if (!err) return null;
    return jobsListLoadErrorPresentation(err, t);
  }, [err, t]);

  async function stopJob(id: string) {
    setStoppingId(id);
    setErr("");
    try {
      await cancelJob(id);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setStoppingId(null);
    }
  }

  const pageJobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const allPageSelected =
    pageJobIds.length > 0 && pageJobIds.every((id) => selectedIds.includes(id));

  function toggleSelectAllOnPage() {
    if (allPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageJobIds.includes(id)));
    } else {
      setSelectedIds((prev) => {
        const set = new Set(prev);
        pageJobIds.forEach((id) => set.add(id));
        return [...set];
      });
    }
  }

  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function purgeSelected() {
    if (selectedIds.length === 0) return;
    const ok = window.confirm(`将永久删除已选中的 ${selectedIds.length} 条任务及其存储，不可恢复。确定？`);
    if (!ok) return;
    setPurgeBusy(true);
    setErr("");
    try {
      for (const id of selectedIds) {
        await purgeJob(id);
      }
      setSelectedIds([]);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      await load();
    } finally {
      setPurgeBusy(false);
    }
  }

  const isAdmin = variant === "admin";

  return (
    <main
      className={
        isAdmin
          ? "min-h-0 min-w-0 w-full max-w-6xl"
          : "mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4"
      }
    >
      {!isAdmin ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/" className="text-sm text-brand hover:text-brand/80">
            ← 首页
          </Link>
        </div>
      ) : null}

      {isAdmin ? (
        <>
          <h1 className="text-2xl font-semibold text-ink">创作记录</h1>
          <p className="mt-2 text-sm text-muted">全站任务列表与状态。</p>
        </>
      ) : (
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">创作记录</h1>
          <p className="mt-2 text-sm text-muted">进度与成品；排队 / 运行中请稍后刷新。</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-ink">
          按状态查看
          <select
            className="ml-2 rounded-lg border border-line bg-fill px-2 py-1.5 text-sm text-ink"
            value={filter}
            onChange={(e) => setFilter(e.target.value as JobStatus | "")}
          >
            <option value="">全部</option>
            <option value="queued">排队</option>
            <option value="running">运行中</option>
            <option value="succeeded">成功</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
        <Button type="button" variant="secondary" loading={loading} busyLabel="刷新中…" onClick={() => void load()}>
          刷新
        </Button>
      </div>

      {errPresentation ? (
        <div
          className={
            errPresentation.variant === "connectivity"
              ? "mt-4 rounded-dawn-lg border border-warning/40 bg-warning-soft0/10 px-3 py-3 text-sm"
              : errPresentation.variant === "auth"
                ? "mt-4 rounded-dawn-lg border border-line bg-fill px-3 py-3 text-sm"
                : "mt-4 rounded-dawn-lg border border-danger/35 bg-danger-soft px-3 py-3 text-sm"
          }
          role="alert"
        >
          <p
            className={
              errPresentation.variant === "connectivity"
                ? "font-medium text-warning-ink"
                : errPresentation.variant === "auth"
                  ? "font-medium text-ink"
                  : "font-medium text-danger"
            }
          >
            {errPresentation.headline}
          </p>
          <p className="mt-1 text-xs text-muted">{errPresentation.sub}</p>
          <p className="mt-2 break-words font-mono text-xs opacity-90">{err}</p>
          {messageSuggestsBillingTopUpOrSubscription(err) ? <BillingShortfallLinks className="mt-3" /> : null}
        </div>
      ) : null}

      {!isAdmin && jobs.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line/80 bg-fill/50 px-3 py-2.5 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={allPageSelected}
              onChange={() => toggleSelectAllOnPage()}
              aria-label="全选本页"
            />
            <span className="text-muted">本页全选</span>
          </label>
          <span className="text-xs text-muted">已选 {selectedIds.length} 条</span>
          <Button
            type="button"
            variant="danger"
            className="!px-3 !py-1.5 !text-xs"
            loading={purgeBusy}
            busyLabel="删除中…"
            disabled={selectedIds.length === 0}
            disabledReason={selectedIds.length === 0 ? "请先勾选任务" : undefined}
            onClick={() => void purgeSelected()}
          >
            删除选中
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-3">
          <SkeletonLine className="h-10 w-full" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={t("empty.jobsList.title")}
          showBrandGlyph={!isAdmin}
          description={isAdmin ? t("empty.jobsList.desc.admin") : t("empty.jobsList.desc.user")}
          action={
            isAdmin ? undefined : (
              <Link href="/create" className="text-sm font-medium text-brand underline underline-offset-2 hover:opacity-90">
                {t("empty.jobsList.cta")}
              </Link>
            )
          }
        />
      ) : (
        <section className="fym-table-shell mt-6 min-w-0 max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[min(110rem,1180px)] text-left text-sm">
            <thead className="border-b border-line bg-fill text-xs text-muted">
              <tr>
                {!isAdmin ? (
                  <th className="w-10 px-2 py-2" aria-label="多选" />
                ) : null}
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">任务 ID</th>
                <th className="px-3 py-2">创建者</th>
                <th className="px-3 py-2">通道</th>
                <th className="px-3 py-2">进度</th>
                <th className="px-3 py-2">耗时</th>
                <th className="px-3 py-2">创建时间</th>
                <th className="px-3 py-2">成品</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const canStop = j.status === "queued" || j.status === "running";
                const peekKinds = succeededContentPeekKinds(j);
                const peekHref = succeededContentPeekHref(j, isAdmin);
                return (
                  <tr key={j.id} className="border-b border-line hover:bg-fill">
                    {!isAdmin ? (
                      <td className="px-2 py-2 align-middle">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand"
                          checked={selectedIds.includes(j.id)}
                          disabled={purgeBusy}
                          onChange={() => toggleRowSelected(j.id)}
                          aria-label={`选择任务 ${j.id.slice(0, 8)}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(j.status)}`}>{j.status}</span>
                    </td>
                    <td className="px-3 py-2 text-ink">{j.job_type}</td>
                    <td className="max-w-[min(22rem,40vw)] px-3 py-2 align-top">
                      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center">
                        <span className="break-all font-mono text-[11px] text-ink/90 select-all" title={j.id}>
                          {j.id}
                        </span>
                        <button
                          type="button"
                          className="w-max shrink-0 rounded border border-line bg-fill px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-surface"
                          onClick={() => void copyJobId(j.id)}
                        >
                          {copiedJobId === j.id ? "已复制" : "复制 ID"}
                        </button>
                      </div>
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-ink" title={jobCreatorDisplayName(j)}>
                      {jobCreatorDisplayName(j)}
                    </td>
                    <td className="px-3 py-2 text-muted">{j.queue_name}</td>
                    <td className="px-3 py-2 text-muted">{j.progress}%</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted">{formatJobDuration(j)}</td>
                    <td className="px-3 py-2 text-xs text-muted">{j.created_at?.replace("T", " ").slice(0, 19) ?? "-"}</td>
                    <td className="px-3 py-2">
                      {peekKinds && peekHref ? (
                        <Link
                          className="text-sm font-medium text-brand underline hover:text-brand/90"
                          href={peekHref}
                          title={isAdmin ? "打开任务详情（含成品与文稿）" : "打开作品详情（含音频与文稿）"}
                        >
                          详情
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="text-brand underline hover:text-brand/90" href={`${basePath}/${j.id}`}>
                          详情
                        </Link>
                        {canStop ? (
                          <Button
                            type="button"
                            variant="danger"
                            className="!px-2 !py-0.5 !text-xs"
                            loading={stoppingId === j.id}
                            busyLabel="停止中…"
                            disabledReason={stoppingId === j.id ? "正在停止" : undefined}
                            onClick={() => void stopJob(j.id)}
                          >
                            停止
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {!loading && jobs.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
          <Button
            type="button"
            variant="secondary"
            className="!py-1.5"
            disabled={page <= 1}
            disabledReason={page <= 1 ? "已在第一页" : undefined}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="tabular-nums text-muted">第 {page} 页</span>
          <Button
            type="button"
            variant="secondary"
            className="!py-1.5"
            disabled={!hasMore}
            disabledReason={!hasMore ? "没有更多" : undefined}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </main>
  );
}
