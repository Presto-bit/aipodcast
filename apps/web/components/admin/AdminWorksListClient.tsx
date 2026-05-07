"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { purgeJob, retryJob } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";
import type { WorkItem } from "../../lib/worksTypes";

const PAGE_SIZE = 40;

const PODCAST_TYPES = new Set(["podcast_generate", "podcast", "podcast_short_video"]);
const TTS_TYPES = new Set(["text_to_speech", "tts"]);

function formatDur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(Number(sec)) || Number(sec) < 0) return "—";
  const s = Math.floor(Number(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${s}s`;
}

function typeLabel(t: string): string {
  const x = String(t || "").trim();
  if (x === "podcast_generate" || x === "podcast") return "播客";
  if (x === "script_draft") return "文章出稿";
  if (x === "text_to_speech" || x === "tts") return "TTS";
  if (x === "podcast_short_video") return "短视频";
  return x || "—";
}

function canTryPlay(w: WorkItem): boolean {
  const t = String(w.type || "");
  if (w.hasAudioHex) return true;
  if (PODCAST_TYPES.has(t) || TTS_TYPES.has(t)) return true;
  return Boolean(String(w.audioUrl || "").trim());
}

export default function AdminWorksListClient() {
  const { getAuthHeaders } = useAuth();
  const { togglePlay, activeJobId, isPlaying, loadingJobId } = useWorkAudioPlayer();
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<{ id: string; kind: "tpl" | "retry" | "purge" } | null>(null);

  const fetchFrom = useCallback(
    async (offset: number, append: boolean) => {
      setErr("");
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const sp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        const res = await fetch(`/api/admin/works?${sp}`, {
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          works?: WorkItem[];
          has_more?: boolean;
          detail?: unknown;
          error?: string;
        };
        if (!res.ok || !data.success) {
          const d = data.detail;
          const msg =
            typeof d === "string" ? d : d !== undefined && d !== null ? JSON.stringify(d) : data.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const list = Array.isArray(data.works) ? data.works : [];
        if (append) {
          setWorks((prev) => {
            const ids = new Set(prev.map((x) => String(x.id || "")));
            const add = list.filter((x) => x.id && !ids.has(String(x.id)));
            return [...prev, ...add];
          });
        } else {
          setWorks(list);
        }
        setNextOffset(offset + list.length);
        setHasMore(Boolean(data.has_more));
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [getAuthHeaders]
  );

  useEffect(() => {
    void fetchFrom(0, false);
  }, [fetchFrom]);

  const setTemplate = useCallback(
    async (jobId: string, enabled: boolean) => {
      setBusy({ id: jobId, kind: "tpl" });
      setErr("");
      try {
        const res = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/podcast-template`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ enabled })
        });
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) {
          const d = body.detail;
          throw new Error(typeof d === "string" ? d : d != null ? JSON.stringify(d) : `HTTP ${res.status}`);
        }
        await fetchFrom(0, false);
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(null);
      }
    },
    [fetchFrom, getAuthHeaders]
  );

  async function onRetry(jobId: string) {
    setBusy({ id: jobId, kind: "retry" });
    setErr("");
    try {
      await retryJob(jobId);
      await fetchFrom(0, false);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function onPurge(jobId: string) {
    const ok = window.confirm(
      `将永久删除作品任务 ${jobId.slice(0, 8)}… 及关联存储，不可恢复。确定？`
    );
    if (!ok) return;
    setBusy({ id: jobId, kind: "purge" });
    setErr("");
    try {
      await purgeJob(jobId);
      setWorks((prev) => prev.filter((x) => String(x.id) !== jobId));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-0 min-w-0 w-full max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink">作品管理</h1>
      <p className="mt-2 text-sm text-muted">
        全站用户已成功生成的作品列表；可试听、打开详情、标记播客模板、重新生成或永久删除。
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          busyLabel="刷新中…"
          onClick={() => void fetchFrom(0, false)}
        >
          刷新
        </Button>
      </div>

      {err ? (
        <div className="mt-4 rounded-dawn-lg border border-danger/35 bg-danger-soft px-3 py-3 text-sm text-danger-ink" role="alert">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-3">
          <SkeletonLine className="h-10 w-full" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
      ) : works.length === 0 ? (
        <EmptyState className="mt-6" title="暂无作品" description="当前没有已成功生成的成片记录。" />
      ) : (
        <section className="fym-table-shell mt-6 min-w-0 max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[min(100rem,1080px)] text-left text-sm">
            <thead className="border-b border-line bg-fill text-xs text-muted">
              <tr>
                <th className="px-3 py-2">标题</th>
                <th className="px-3 py-2">创建者</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">时长 / 字数</th>
                <th className="px-3 py-2">完成时间</th>
                <th className="px-3 py-2">模板</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {works.map((w) => {
                const id = String(w.id || "").trim();
                if (!id) return null;
                const title = String(w.title || id.slice(0, 8)).trim() || id.slice(0, 8);
                const creator = String(w.creatorLabel || "—").trim() || "—";
                const jt = String(w.type || "");
                const isPod = jt === "podcast_generate" || jt === "podcast";
                const tplOn = Boolean(w.isPodcastPublicTemplate);
                const playingHere = activeJobId === id && isPlaying;
                const loadHere = loadingJobId === id;
                const b = busy?.id === id ? busy.kind : null;
                const canPlay = canTryPlay(w);
                return (
                  <tr key={id} className="border-b border-line hover:bg-fill">
                    <td className="max-w-[14rem] px-3 py-2">
                      <span className="line-clamp-2 text-ink" title={title}>
                        {title}
                      </span>
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-ink" title={creator}>
                      {creator}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{typeLabel(jt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                      {typeof w.scriptCharCount === "number" && w.scriptCharCount > 0
                        ? `${w.scriptCharCount} 字`
                        : formatDur(w.audioDurationSec ?? null)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                      {String(w.createdAt || "").replace("T", " ").slice(0, 19) || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{tplOn ? "是" : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {canPlay ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="!px-2 !py-0.5 !text-xs"
                            loading={loadHere}
                            busyLabel="加载中…"
                            disabledReason={loadHere ? "加载中" : undefined}
                            onClick={() =>
                              void togglePlay(id, {
                                displayTitle: title,
                                usePodcastPublicTemplateListen: tplOn && isPod
                              })
                            }
                          >
                            {playingHere ? "暂停播放" : loadHere ? "…" : "播放"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">无音频</span>
                        )}
                        <Link className="text-brand underline hover:text-brand/90" href={`/admin/jobs/${encodeURIComponent(id)}`}>
                          详情
                        </Link>
                        <Button
                          type="button"
                          variant="secondary"
                          className="!px-2 !py-0.5 !text-xs"
                          loading={b === "retry"}
                          busyLabel="提交中…"
                          disabledReason={b === "retry" ? "提交中" : undefined}
                          onClick={() => void onRetry(id)}
                        >
                          重新生成
                        </Button>
                        {isPod ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="!px-2 !py-0.5 !text-xs"
                            loading={b === "tpl"}
                            busyLabel="保存中…"
                            disabledReason={b === "tpl" ? "保存中" : undefined}
                            onClick={() => void setTemplate(id, !tplOn)}
                          >
                            {tplOn ? "取消模板" : "设为模板"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="danger"
                          className="!px-2 !py-0.5 !text-xs"
                          loading={b === "purge"}
                          busyLabel="删除中…"
                          disabledReason={b === "purge" ? "删除中" : undefined}
                          onClick={() => void onPurge(id)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {!loading && hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            loading={loadingMore}
            busyLabel="加载中…"
            onClick={() => void fetchFrom(nextOffset, true)}
          >
            加载更多
          </Button>
        </div>
      ) : null}
    </main>
  );
}
