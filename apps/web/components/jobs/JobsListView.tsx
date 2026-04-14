"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { cancelJob, listJobs } from "../../lib/api";
import { jobsListLoadErrorPresentation } from "../../lib/jobsListErrors";
import { listRememberedJobIds } from "../../lib/jobRecent";
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
  const [remembered, setRemembered] = useState<string[]>([]);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

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
    setRemembered(listRememberedJobIds());
  }, [jobs]);

  const idsOnPage = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);
  const extraRemembered = useMemo(() => remembered.filter((id) => !idsOnPage.has(id)), [remembered, idsOnPage]);
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

      {!isAdmin && extraRemembered.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-line bg-fill/80 p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">本机最近创建</h2>
          <p className="mt-1 text-xs text-muted">列表未显示时可从此打开详情。</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {extraRemembered.map((id) => (
              <li key={id}>
                <Link className="text-brand underline hover:text-brand/90" href={`${basePath}/${id}`}>
                  {id.slice(0, 8)}…
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
        <section className="fym-table-shell mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line bg-fill text-xs text-muted">
              <tr>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">创建者</th>
                <th className="px-3 py-2">通道</th>
                <th className="px-3 py-2">进度</th>
                <th className="px-3 py-2">创建时间</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const canStop = j.status === "queued" || j.status === "running";
                const operator = j.created_by?.trim() || "—";
                return (
                  <tr key={j.id} className="border-b border-line hover:bg-fill">
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(j.status)}`}>{j.status}</span>
                    </td>
                    <td className="px-3 py-2 text-ink">{j.job_type}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-muted" title={operator}>
                      {operator}
                    </td>
                    <td className="px-3 py-2 text-muted">{j.queue_name}</td>
                    <td className="px-3 py-2 text-muted">{j.progress}%</td>
                    <td className="px-3 py-2 text-xs text-muted">{j.created_at?.replace("T", " ").slice(0, 19) ?? "-"}</td>
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
