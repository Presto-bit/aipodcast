"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, deleteJob, listJobs } from "../../lib/api";
import { jobTypeLabel } from "../../lib/jobStage";
import { summarizeActiveJobPayload } from "../../lib/jobPayloadSummary";
import type { JobRecord, JobStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { classifyErrorTone, errorPageCopy } from "../../lib/errorCopy";
import { useAuth } from "../../lib/auth";

const POLL_MS = 5000;
const LIST_LIMIT = 80;

function statusLabel(st: JobStatus): string {
  if (st === "queued") return "排队中";
  if (st === "running") return "执行中";
  return st;
}

function statusBadgeClass(st: JobStatus): string {
  if (st === "queued") return "bg-track text-ink";
  if (st === "running") return "bg-fill text-brand";
  return "bg-track text-ink";
}

type WorksActiveJobsPanelProps = {
  /** 删除或停止成功后可更新父级「进行中」数量等 */
  onActiveJobsChanged?: () => void;
};

export default function WorksActiveJobsPanel({ onActiveJobsChanged }: WorksActiveJobsPanelProps = {}) {
  const { phone, ready } = useAuth();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const visibleRef = useRef(true);
  /** 删成功后若列表接口短暂仍返回该 job，过滤掉，避免整表覆盖导致「删了还在」 */
  const suppressedIdsRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    setErr("");
    try {
      const { jobs: list } = await listJobs({
        limit: LIST_LIMIT,
        offset: 0,
        status: "queued,running",
        slim: false
      });
      const suppressed = suppressedIdsRef.current;
      for (const jid of [...suppressed]) {
        if (!list.some((j) => String(j.id) === jid)) {
          suppressed.delete(jid);
        }
      }
      setJobs(list.filter((j) => !suppressed.has(String(j.id))));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [load, ready, phone]);

  useEffect(() => {
    function onVis() {
      visibleRef.current = document.visibilityState === "visible";
    }
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (visibleRef.current) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, ready]);

  const errCopy = err ? errorPageCopy(classifyErrorTone(err)) : null;

  async function stopJob(id: string) {
    setStoppingId(id);
    setErr("");
    try {
      await cancelJob(id);
      onActiveJobsChanged?.();
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setStoppingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    const id = deleteTarget.id;
    const mayNeedCancel = deleteTarget.status === "queued" || deleteTarget.status === "running";
    try {
      // 软删优先：仅 SQL，避免先 await cancel（编排器会扫全队列 job_ids，任务多时极慢/超时导致永远也走不到 delete）
      try {
        await deleteJob(id);
      } catch (e) {
        const raw = String(e instanceof Error ? e.message : e);
        if (!mayNeedCancel || !/delete_failed|409/i.test(raw)) throw e;
        try {
          await Promise.race([
            cancelJob(id),
            new Promise<never>((_, rej) => {
              window.setTimeout(() => rej(new Error("cancel_timeout")), 12_000);
            })
          ]);
        } catch {
          /* 取消失败或超时也再试删一次 */
        }
        await deleteJob(id);
      }
      suppressedIdsRef.current.add(String(id));
      setDeleteTarget(null);
      setJobs((prev) => prev.filter((j) => String(j.id) !== String(id)));
      onActiveJobsChanged?.();
      await load();
      // 已移出列表后后台再尝试取消 RQ，不阻塞界面
      if (mayNeedCancel) {
        void cancelJob(id).catch(() => {});
      }
    } catch (e) {
      const raw = String(e instanceof Error ? e.message : e);
      setDeleteErr(
        /delete_failed|409/i.test(raw) ? "删除未完成，请稍后重试或先点「停止」再删。" : raw
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-4 space-y-3">
        <SkeletonLine className="h-10 w-full" />
        <SkeletonBlock className="h-36 w-full" />
        <SkeletonBlock className="h-36 w-full" />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="mb-4 text-center text-sm text-muted">
        显示排队与执行中的创作任务；摘要来自提交内容，进度会周期性自动刷新。
      </p>

      {errCopy ? (
        <div className="mb-4 rounded-dawn-lg border border-danger/35 bg-danger-soft px-3 py-3 text-sm" role="alert">
          <p className="font-medium text-danger">{errCopy.headline}</p>
          <p className="mt-1 text-xs text-muted">{errCopy.sub}</p>
          <p className="mt-2 break-words font-mono text-xs text-ink">{err}</p>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          title="没有进行中的任务"
          description="新建 AI 播客、文本转语音或笔记出稿后，会在这里看到队列与生成进度。"
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/podcast" className="text-sm text-brand underline">
                AI 播客
              </Link>
              <Link href="/tts" className="text-sm text-brand underline">
                文本转语音
              </Link>
              <Link href="/notes" className="text-sm text-brand underline">
                笔记播客
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="space-y-4">
          {jobs.map((j) => {
            const { headline, detail } = summarizeActiveJobPayload(j);
            const canStop = j.status === "queued" || j.status === "running";
            const pct = Math.max(0, Math.min(100, Math.round(Number(j.progress) || 0)));
            return (
              <li
                key={j.id}
                className="rounded-2xl border border-line bg-fill/60 p-4 shadow-sm backdrop-blur-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(j.status)}`}>
                        {statusLabel(j.status)}
                      </span>
                      <span className="text-xs text-muted">{jobTypeLabel(j.job_type)}</span>
                      <span className="text-xs text-muted">· {j.queue_name}</span>
                    </div>
                    <h2 className="mt-2 line-clamp-2 text-base font-semibold text-ink">{headline}</h2>
                    <p className="mt-1 line-clamp-3 text-sm text-muted">{detail}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/jobs/${j.id}`}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-brand hover:bg-fill"
                    >
                      详情
                    </Link>
                    {canStop ? (
                      <Button
                        type="button"
                        variant="danger"
                        className="!px-3 !py-1.5 !text-xs"
                        loading={stoppingId === j.id}
                        busyLabel="停止中…"
                        disabledReason={stoppingId === j.id ? "正在停止" : undefined}
                        onClick={() => void stopJob(j.id)}
                      >
                        停止
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      className="!border-rose-300 !px-3 !py-1.5 !text-xs !text-rose-800 hover:!bg-rose-50"
                      onClick={() => {
                        setDeleteErr(null);
                        setDeleteTarget(j);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>进度</span>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-track">
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    创建于 {j.created_at?.replace("T", " ").slice(0, 19) ?? "—"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SmallConfirmModal
        open={Boolean(deleteTarget)}
        title="删除任务？"
        message={
          deleteTarget && (deleteTarget.status === "queued" || deleteTarget.status === "running")
            ? "该任务仍在排队或执行。删除后将移入回收站并从列表隐藏；若未先停止，后台仍可能短暂继续处理。确定删除？"
            : "将把该任务移入回收站。确定删除？"
        }
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        busy={deleteBusy}
        busyLabel="删除中…"
        error={deleteErr}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setDeleteErr(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
