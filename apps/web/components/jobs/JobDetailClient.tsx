"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { jobEventsSourceUrl } from "../../lib/authHeaders";
import { cancelJob, getJob, retryJob } from "../../lib/api";
import { classifyErrorTone, errorPageCopy } from "../../lib/errorCopy";
import { useI18n } from "../../lib/I18nContext";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { classifyJobError, failureCopy, failureRecoveryLink } from "../../lib/jobFailure";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import { deriveJobStage, type StreamPayload } from "../../lib/jobStage";
import { supportMailtoWithJob } from "../../lib/supportLink";
import { JOB_SECTION_SURFACE_CARD } from "../../lib/jobSectionClasses";
import type { JobArtifactRecord, JobRecord } from "../../lib/types";
import { readSessionStorageScoped, writeSessionStorageScoped } from "../../lib/userScopedStorage";

function extractPreviewText(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  const prev = result.preview ?? result.script_preview;
  if (typeof prev === "string" && prev.trim()) return prev.trim();
  const art = result.artifact as Record<string, unknown> | undefined;
  if (art && typeof art === "object") return "";
  return "";
}

function pickScriptArtifactId(artifacts: JobArtifactRecord[] | undefined): string | null {
  if (!artifacts?.length) return null;
  const script = artifacts.find((a) => String(a.artifact_type || "").toLowerCase() === "script");
  const id = script?.id;
  return id ? String(id) : null;
}

function pickArtifactIdByKeyword(artifacts: JobArtifactRecord[] | undefined, keyword: string): string | null {
  if (!artifacts?.length) return null;
  const k = keyword.toLowerCase();
  const target = artifacts.find((a) => String(a.artifact_type || "").toLowerCase().includes(k));
  const id = target?.id;
  return id ? String(id) : null;
}

function jobShareDisplayTitle(job: JobRecord): string {
  const r = job.result || {};
  const p = job.payload || {};
  const t = String(r.title || (p as { title?: string }).title || (p as { project_name?: string }).project_name || "").trim();
  return t || `作品 ${job.id.slice(0, 8)}…`;
}

function jobUiCacheKey(jobId: string): string {
  return `fym_job_ui_cache_v1:${jobId}`;
}

export type JobDetailClientProps = {
  jobId: string;
  /** 返回列表的 path，如 `/jobs` 或 `/admin/jobs` */
  recordsListHref: string;
};

export function JobDetailClient({ jobId, recordsListHref }: JobDetailClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [events, setEvents] = useState<StreamPayload[]>([]);
  const [streamingTail, setStreamingTail] = useState("");
  const lastEventIdRef = useRef(0);
  const [copyManuscriptBusy, setCopyManuscriptBusy] = useState(false);
  const [copyManuscriptHint, setCopyManuscriptHint] = useState<string | null>(null);
  const copyManuscriptHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [partialRedoPrompt, setPartialRedoPrompt] = useState("");
  const [partialRedoScope, setPartialRedoScope] = useState<"full" | "intro" | "middle" | "outro">("full");

  const appendEvent = useCallback((incoming: StreamPayload) => {
    setEvents((prev) => {
      const incomingId = Number(incoming.id || 0);
      if (incomingId > 0 && prev.some((x) => Number(x.id || 0) === incomingId)) return prev;
      return [...prev, incoming];
    });
  }, []);

  useEffect(() => {
    if (!jobId) return;
    try {
      const raw = readSessionStorageScoped(jobUiCacheKey(jobId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        job?: JobRecord | null;
        events?: StreamPayload[];
        streamingTail?: string;
      };
      if (parsed.job && typeof parsed.job === "object") setJob(parsed.job);
      if (Array.isArray(parsed.events)) {
        const safeEvents = parsed.events.slice(-200);
        setEvents(safeEvents);
        const lastId = Number(safeEvents[safeEvents.length - 1]?.id || 0);
        if (Number.isFinite(lastId) && lastId > 0) lastEventIdRef.current = lastId;
      }
      if (typeof parsed.streamingTail === "string") setStreamingTail(parsed.streamingTail);
    } catch {
      // ignore cache parse errors
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    try {
      const last200 = events.slice(-200);
      writeSessionStorageScoped(
        jobUiCacheKey(jobId),
        JSON.stringify({
          job,
          events: last200,
          streamingTail
        })
      );
    } catch {
      // ignore storage quota / privacy mode errors
    }
  }, [jobId, job, events, streamingTail]);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoadErr("");
    try {
      const row = await getJob(jobId);
      setJob(row);
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!jobId) return;
    const afterId = Math.max(0, Number(lastEventIdRef.current || 0));
    const es = new EventSource(jobEventsSourceUrl(jobId, afterId));
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as StreamPayload;
        const dataId = Number(data.id || 0);
        if (Number.isFinite(dataId) && dataId > 0) {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, dataId);
        }
        if (data.type === "terminal") {
          appendEvent(data);
          es.close();
          void getJob(jobId)
            .then(setJob)
            .catch(() => {});
          return;
        }
        appendEvent(data);
        if (data.type === "script_chunk") {
          const p = data.payload || {};
          const tail = typeof p.text_tail === "string" ? p.text_tail : "";
          if (tail) setStreamingTail(tail);
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [appendEvent, jobId]);

  useEffect(() => {
    if (!job?.result) return;
    const prev = extractPreviewText(job.result);
    if (prev) setStreamingTail((t) => (t.length < prev.length ? prev : t));
  }, [job?.result]);

  /** script_draft：result.preview 仅约 240 字；成功后应从 script 工件拉全文，否则界面/复制只有摘要。 */
  const scriptArtifactId = useMemo(() => pickScriptArtifactId(job?.artifacts), [job?.artifacts]);
  useEffect(() => {
    if (!jobId || String(job?.job_type || "") !== "script_draft") return;
    if (String(job?.status || "") !== "succeeded") return;
    const aid = scriptArtifactId;
    if (!aid) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/artifacts/${encodeURIComponent(aid)}/download`, {
          credentials: "same-origin"
        });
        if (!res.ok || cancelled) return;
        const full = (await res.text()).trim();
        if (!full || cancelled) return;
        setStreamingTail((t) => (full.length > t.length ? full : t));
      } catch {
        /* 保留 SSE / 预览已有内容 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, job?.job_type, job?.status, scriptArtifactId]);

  useEffect(() => {
    return () => {
      if (copyManuscriptHintTimerRef.current) clearTimeout(copyManuscriptHintTimerRef.current);
    };
  }, []);

  const copyManuscript = useCallback(async () => {
    if (!jobId) return;
    setCopyManuscriptHint(null);
    setCopyManuscriptBusy(true);
    try {
      let text = "";
      const isDraft = String(job?.job_type || "") === "script_draft";
      const succeeded = String(job?.status || "") === "succeeded";
      const aid = scriptArtifactId;
      if (isDraft && succeeded && aid) {
        const res = await fetch(`/api/jobs/${jobId}/artifacts/${encodeURIComponent(aid)}/download`, {
          credentials: "same-origin"
        });
        if (res.ok) text = (await res.text()).trim();
        else throw new Error(`读取文稿失败 HTTP ${res.status}`);
      }
      if (!text) text = (streamingTail || "").trim();
      if (!text && aid) {
        const res = await fetch(`/api/jobs/${jobId}/artifacts/${encodeURIComponent(aid)}/download`, {
          credentials: "same-origin"
        });
        if (res.ok) text = (await res.text()).trim();
        else if (!text) throw new Error(`读取文稿失败 HTTP ${res.status}`);
      }
      if (!text && job?.result) text = extractPreviewText(job.result);
      if (!text) {
        window.alert("暂无文稿；完成后请刷新重试。");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopyManuscriptHint("已复制");
      if (copyManuscriptHintTimerRef.current) clearTimeout(copyManuscriptHintTimerRef.current);
      copyManuscriptHintTimerRef.current = setTimeout(() => setCopyManuscriptHint(null), 2500);
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCopyManuscriptBusy(false);
    }
  }, [jobId, streamingTail, job?.artifacts, job?.result, job?.job_type, job?.status, scriptArtifactId]);

  const stage = useMemo(() => deriveJobStage(job, events), [job, events]);
  const previewText = useMemo(() => extractPreviewText(job?.result), [job?.result]);
  const audioArtifactId = useMemo(() => pickArtifactIdByKeyword(job?.artifacts, "audio"), [job?.artifacts]);
  const loadErrCopy = useMemo(() => {
    if (!loadErr) return null;
    return errorPageCopy(classifyErrorTone(loadErr), t);
  }, [loadErr, t]);

  const traceId =
    job?.result && typeof job.result.trace_id === "string" ? job.result.trace_id : null;

  async function onCancel() {
    if (!jobId || !window.confirm("确定要停止这次创作吗？")) return;
    setBusy("cancel");
    try {
      await cancelJob(jobId);
      await load();
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
    }
  }

  async function onRetry() {
    if (!jobId) return;
    setBusy("retry");
    try {
      const next = await retryJob(jobId);
      router.push(`${recordsListHref.replace(/\/$/, "")}/${next.id}`);
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
    }
  }

  async function onCopyPreview() {
    const text = (previewText || streamingTail || "").trim();
    if (!text) {
      window.alert("暂无摘要。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      window.alert("已复制");
    } catch {
      window.alert("复制失败");
    }
  }

  function goPartialRedo() {
    const text = (previewText || streamingTail || "").trim();
    if (!text) {
      window.alert("暂无文稿。");
      return;
    }
    try {
      writeSessionStorageScoped(
        "fym_podcast_partial_redo_v1",
        JSON.stringify({
          sourceJobId: jobId,
          text,
          prompt: partialRedoPrompt.trim(),
          scope: partialRedoScope
        })
      );
      router.push("/podcast");
    } catch {
      window.alert("暂存失败，请重试。");
    }
  }

  if (!jobId) {
    return (
      <main className="min-h-0">
        <p className="text-muted">找不到这条记录</p>
      </main>
    );
  }

  return (
    <main className="min-h-0 max-w-4xl">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">生成结果详情</h1>
        <code className="rounded bg-surface px-2 py-0.5 text-xs text-muted">{jobId}</code>
      </div>
      <p className="mt-2 text-sm text-muted">
        <Link href={recordsListHref} className="text-brand hover:text-brand/85 hover:underline">
          ← 返回任务列表
        </Link>
      </p>

      {loadErrCopy ? (
        <div className="mt-4 rounded-dawn-lg border border-danger/35 bg-danger-soft px-3 py-3 text-sm" role="alert">
          <p className="font-medium text-danger">{loadErrCopy.headline}</p>
          <p className="mt-1 text-xs text-muted">{loadErrCopy.sub}</p>
          <p className="mt-2 break-words font-mono text-xs text-ink">{loadErr}</p>
        </div>
      ) : null}

      {job ? (
        <section className={`${JOB_SECTION_SURFACE_CARD} text-sm`}>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-dawn-sm bg-fill px-2 py-0.5 text-xs text-ink">{job.status}</span>
            <span className="text-muted">类型 {job.job_type}</span>
            {job.created_by ? <span className="text-muted">创建者 {job.created_by}</span> : null}
            <span className="text-muted">通道 {job.queue_name}</span>
            <span className="text-muted tabular-nums">进度 {job.progress}%</span>
          </div>
          {(job.status === "queued" || job.status === "running") && typeof job.progress === "number" ? (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>总体进度（后端上报，各类型含义可能略有不同）</span>
                <span className="tabular-nums">{Math.min(100, Math.max(0, job.progress))}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-fill"
                data-testid="job-detail-progressbar"
                role="progressbar"
                aria-valuenow={Math.min(100, Math.max(0, job.progress))}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="任务进度"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                />
              </div>
            </div>
          ) : null}
          {job.status === "queued" || job.status === "running" ? (
            <div
              className="mt-4 rounded-dawn-lg border border-line bg-fill/90 p-3"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <p className="text-sm font-medium text-ink">当前阶段 · {stage.stageLabel}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{stage.nextStep}</p>
              {stage.detail ? (
                <p className="mt-2 border-t border-line pt-2 text-xs text-muted">{stage.detail}</p>
              ) : null}
            </div>
          ) : null}
          {job.status === "queued" || job.status === "running" ? (
            <div className="mt-3 rounded-lg border border-line bg-surface/90 px-3 py-2 text-[11px] leading-relaxed text-muted" role="status">
              <p className="text-muted">
                {job.status === "queued"
                  ? "排队中，请稍候。"
                  : "生成中；久无进展可刷新或点「停止创作」后重试。"}
              </p>
              <p className="mt-1.5">
                无需一直停在本页：可先去写笔记或处理其他事，完成后到{" "}
                <Link href="/works?tab=active" className="font-medium text-brand hover:underline">
                  我的作品 → 进行中
                </Link>{" "}
                或刷新本页查看结果。
              </p>
            </div>
          ) : null}
          {job.error_message ? (
            <div className="mt-3 rounded border border-danger/40 bg-danger-soft/80 px-3 py-2 text-xs text-danger-ink">
              <p>{job.error_message}</p>
              {messageSuggestsBillingTopUpOrSubscription(job.error_message) ? (
                <BillingShortfallLinks className="mt-2 border-t border-danger/25 pt-2" />
              ) : null}
            </div>
          ) : null}
          {job.status === "failed" ? (
            <div className="mt-3 space-y-2 rounded border border-danger/40 bg-danger-soft p-3 text-xs" role="alert">
              {(() => {
                const k = classifyJobError(job.error_message);
                const fc = failureCopy(k);
                const recovery = failureRecoveryLink(k);
                return (
                  <>
                    <p className="font-medium text-danger-ink">{fc.title}</p>
                    <p className="text-danger-ink/90">{fc.hint}</p>
                    {recovery ? (
                      <Link
                        href={recovery.href}
                        className="inline-block font-medium text-brand underline hover:text-brand/80"
                      >
                        {recovery.label} →
                      </Link>
                    ) : null}
                  </>
                );
              })()}
              <p className="break-all font-mono text-[10px] text-muted">记录 ID：{jobId}</p>
              <p className="text-warning-ink/90">可先重试下方按钮；联系客服时请附记录 ID 或追踪编号。</p>
              <a
                href={supportMailtoWithJob(jobId)}
                className="inline-block font-medium text-brand underline hover:text-brand/80"
              >
                邮件客服（含记录编号）
              </a>
            </div>
          ) : null}
          {traceId ? (
            <p className="mt-3 text-xs text-muted">
              追踪编号{" "}
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => void navigator.clipboard.writeText(traceId)}
                title="复制"
              >
                {traceId}
              </button>
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={recordsListHref}
              className="inline-flex items-center rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink hover:bg-fill"
            >
              返回列表
            </Link>
            {job.status === "running" || job.status === "queued" ? (
              <Button
                type="button"
                variant="danger"
                loading={busy === "cancel"}
                busyLabel="取消中…"
                disabledReason={busy === "cancel" ? "正在取消" : undefined}
                className="text-xs"
                onClick={() => void onCancel()}
              >
                停止创作
              </Button>
            ) : null}
            {job.status === "failed" || job.status === "cancelled" ? (
              <Button
                type="button"
                variant="primary"
                loading={busy === "retry"}
                busyLabel="创建中…"
                className="text-xs"
                onClick={() => void onRetry()}
              >
                重新生成
              </Button>
            ) : null}
          </div>
          {job.status === "succeeded" ? (
            <div className="mt-4 rounded-dawn-lg border border-line bg-fill/75 p-3">
              <p className="text-xs font-medium text-muted">成品</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {audioArtifactId ? (
                  <a
                    className="rounded-dawn-sm bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand/90"
                    href={`/api/jobs/${jobId}/artifacts/${audioArtifactId}/download`}
                  >
                    播放 / 下载音频
                  </a>
                ) : null}
                {audioArtifactId ? (
                  <Link
                    href={`/works/share/${jobId}`}
                    className="rounded-dawn-sm border border-brand/50 bg-brand/10 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/15"
                    onClick={() => {
                      try {
                        writeSessionStorageScoped(`fym_share_display_title:${jobId}`, jobShareDisplayTitle(job));
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    发给朋友
                  </Link>
                ) : null}
                {scriptArtifactId ? (
                  <a
                    className="rounded-dawn-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink hover:bg-fill"
                    href={`/api/jobs/${jobId}/artifacts/${scriptArtifactId}/download`}
                  >
                    下载文稿
                  </a>
                ) : null}
                <button
                  type="button"
                  className="rounded-dawn-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink hover:bg-fill"
                  onClick={() => void onCopyPreview()}
                >
                  复制文案摘要
                </button>
                <button
                  type="button"
                  className="rounded-dawn-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink hover:bg-fill"
                  onClick={() => void onRetry()}
                >
                  再次生成
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : !loadErr ? (
        <p className="mt-6 text-sm text-muted">加载中…</p>
      ) : null}

      {job?.artifacts && job.artifacts.length > 0 ? (
        <section className="fym-table-shell mt-6 p-[var(--dawn-space-card)]">
          <h2 className="text-sm font-medium text-ink">生成结果</h2>
          <ul className="mt-2 space-y-2 text-xs">
            {job.artifacts.map((a) => (
              <li key={a.id} className="rounded border border-line bg-fill p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted">{a.artifact_type}</span>
                  <a
                    className="rounded-dawn-sm bg-brand px-2 py-1 text-[11px] text-brand-foreground hover:bg-brand/90"
                    href={`/api/jobs/${jobId}/artifacts/${a.id}/download`}
                  >
                    下载文件
                  </a>
                </div>
                <div className="mt-1 break-all font-mono text-ink">{a.object_key}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(streamingTail ||
        job?.status === "running" ||
        (job && ["script_draft", "podcast_generate", "podcast"].includes(job.job_type))) && (
        <section className={JOB_SECTION_SURFACE_CARD}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-ink">文案预览</h2>
            </div>
            {job?.job_type === "script_draft" ? (
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 text-xs"
                loading={copyManuscriptBusy}
                busyLabel="复制中…"
                onClick={() => void copyManuscript()}
              >
                复制文稿
              </Button>
            ) : null}
          </div>
          {job?.job_type === "script_draft" && copyManuscriptHint ? (
            <p className="mt-2 text-xs text-success-ink dark:text-success-ink" role="status">
              {copyManuscriptHint}
            </p>
          ) : null}
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-fill p-3 text-xs text-ink">
            {streamingTail || "撰写中…"}
          </pre>
          {job?.status === "succeeded" ? (
            <div className="mt-3 rounded border border-line bg-surface p-3">
              <p className="text-xs font-medium text-ink">局部重做</p>
              <p className="mt-1 text-xs text-muted">选范围后输入修改要求。</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className={`rounded border px-2 py-1 ${partialRedoScope === "full" ? "border-brand bg-fill text-ink" : "border-line bg-surface text-muted"}`}
                  onClick={() => setPartialRedoScope("full")}
                >
                  全文
                </button>
                <button
                  type="button"
                  className={`rounded border px-2 py-1 ${partialRedoScope === "intro" ? "border-brand bg-fill text-ink" : "border-line bg-surface text-muted"}`}
                  onClick={() => setPartialRedoScope("intro")}
                >
                  开场
                </button>
                <button
                  type="button"
                  className={`rounded border px-2 py-1 ${partialRedoScope === "middle" ? "border-brand bg-fill text-ink" : "border-line bg-surface text-muted"}`}
                  onClick={() => setPartialRedoScope("middle")}
                >
                  中段
                </button>
                <button
                  type="button"
                  className={`rounded border px-2 py-1 ${partialRedoScope === "outro" ? "border-brand bg-fill text-ink" : "border-line bg-surface text-muted"}`}
                  onClick={() => setPartialRedoScope("outro")}
                >
                  结尾
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="rounded border border-line bg-fill px-2 py-1 text-ink hover:bg-surface"
                  onClick={() => {
                    const scopeLabel = partialRedoScope === "intro" ? "开场" : partialRedoScope === "middle" ? "中段" : partialRedoScope === "outro" ? "结尾" : "全文";
                    setPartialRedoPrompt(`仅重写${scopeLabel}，保留其余段落结构与主要信息不变。`);
                  }}
                >
                  保留其余段落不变
                </button>
                <button
                  type="button"
                  className="rounded border border-line bg-fill px-2 py-1 text-ink hover:bg-surface"
                  onClick={() => {
                    const scopeLabel = partialRedoScope === "intro" ? "开场" : partialRedoScope === "middle" ? "中段" : partialRedoScope === "outro" ? "结尾" : "全文";
                    setPartialRedoPrompt(`优化${scopeLabel}语气，让表达更口语化、更有节奏。其余段落尽量保持不变。`);
                  }}
                >
                  口语化优化模板
                </button>
              </div>
              <textarea
                className="mt-2 min-h-[72px] w-full rounded border border-line bg-fill p-2 text-xs text-ink"
                value={partialRedoPrompt}
                onChange={(e) => setPartialRedoPrompt(e.target.value)}
                placeholder="例如：保留结构，重点重写开场，让语气更轻松"
              />
              <button
                type="button"
                className="mt-2 rounded border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:bg-fill"
                onClick={goPartialRedo}
              >
                带当前文稿去局部重做
              </button>
            </div>
          ) : null}
        </section>
      )}

      <section className={JOB_SECTION_SURFACE_CARD}>
        <h2 className="text-sm font-medium text-ink">处理记录</h2>
        <p className="mt-1 text-xs text-muted">以下为后台步骤摘要，完成后本页会自动更新。</p>
        <div className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
          {events.length === 0 ? <p className="text-muted">暂无记录，或正在连接中…</p> : null}
          {events.map((ev, i) => (
            <div key={`${ev.id ?? i}_${i}`} className="rounded border border-line/80 bg-canvas/50 px-2 py-1">
              <span className="text-muted">{(ev.type || "?") + " "}</span>
              <span className="text-muted">{ev.message || ""}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
