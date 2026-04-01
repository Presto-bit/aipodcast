"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { hexToMp3DataUrl } from "../../lib/audioHex";
import { useAuth } from "../../lib/auth";
import { scheduleCloudPreferencesPush } from "../../lib/cloudPreferences";
import { downloadJobBundleZip } from "../../lib/workBundleDownload";
import {
  listRssChannels,
  listRssPublicationsByJobIds,
  publishWorkToRss,
  type RssChannel,
  type RssPublication
} from "../../lib/api";
import type { WorkItem } from "../../lib/worksTypes";

const PODCAST_TYPES = new Set(["podcast_generate", "podcast"]);
const TTS_TYPES = new Set(["text_to_speech"]);
/** 笔记播客出稿（script_draft） */
const NOTES_WORK_TYPES = new Set(["script_draft"]);
/** 笔记播客页：成片 + 文章出稿 */
const NOTES_STUDIO_TYPES = new Set(["podcast_generate", "podcast", "script_draft"]);

type GalleryKeys = {
  hiddenKey: string;
  titlesKey: string;
  /** null 表示不过滤类型（首页「全部作品」合并列表） */
  allowedTypes: Set<string> | null;
};

function galleryStorageKeys(variant: "podcast" | "tts" | "notes" | "notes_studio" | "all"): GalleryKeys {
  if (variant === "all") {
    return {
      hiddenKey: "fym_all_works_hidden_v1",
      titlesKey: "fym_all_works_display_titles_v1",
      allowedTypes: null
    };
  }
  if (variant === "tts") {
    return {
      hiddenKey: "fym_tts_works_hidden_v1",
      titlesKey: "fym_tts_works_display_titles_v1",
      allowedTypes: TTS_TYPES
    };
  }
  if (variant === "notes_studio") {
    return {
      hiddenKey: "fym_notes_studio_works_hidden_v1",
      titlesKey: "fym_notes_studio_works_display_titles_v1",
      allowedTypes: NOTES_STUDIO_TYPES
    };
  }
  if (variant === "notes") {
    return {
      hiddenKey: "fym_notes_works_hidden_v1",
      titlesKey: "fym_notes_works_display_titles_v1",
      allowedTypes: NOTES_WORK_TYPES
    };
  }
  return {
    hiddenKey: "fym_podcast_works_hidden_v1",
    titlesKey: "fym_podcast_works_display_titles_v1",
    allowedTypes: PODCAST_TYPES
  };
}

/** 外链封面常因防盗链无法在浏览器直接显示，走同源代理 */
function coverImageSrc(url: string | undefined | null): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("data:") || u.startsWith("/")) return u;
  return `/api/image-proxy?url=${encodeURIComponent(u)}`;
}

function loadHiddenIds(hiddenKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenKey);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveHiddenIds(hiddenKey: string, s: Set<string>) {
  try {
    localStorage.setItem(hiddenKey, JSON.stringify([...s]));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
}

function loadTitles(titlesKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(titlesKey);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function saveTitles(titlesKey: string, m: Record<string, string>) {
  try {
    localStorage.setItem(titlesKey, JSON.stringify(m));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CircularPlayControl({
  playing,
  progress,
  disabled,
  onClick
}: {
  playing: boolean;
  progress: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const r = 41;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - p);
  return (
    <div className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
      <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-line" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className="stroke-brand transition-[stroke-dashoffset]"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={playing ? "暂停" : "播放"}
        className="relative z-[1] flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-surface text-brand shadow-card-sm outline-none ring-offset-2 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-60"
      >
        {playing ? (
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg className="ml-px h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}

type PodcastWorkRow = WorkItem & { displayTitle: string };

type Props = {
  works: WorkItem[];
  loading: boolean;
  fetchError: string;
  onDismissError?: () => void;
  /** 服务端删除成功后回调（用于刷新列表） */
  onWorkDeleted?: () => void;
  /** 播客成片（默认）、TTS、笔记出稿、笔记播客页合并列表，或首页「全部类型」 */
  variant?: "podcast" | "tts" | "notes" | "notes_studio" | "all";
  /** 仅在作品管理页开启：支持批量下载入口 */
  enableBatchActions?: boolean;
};

const PODCAST_REUSE_TEMPLATE_KEY = "fym_reuse_template_podcast_v1";
const TTS_REUSE_TEMPLATE_KEY = "fym_reuse_template_tts_v1";
const NOTES_REUSE_TEMPLATE_KEY = "fym_reuse_template_notes_v1";

export default function PodcastWorksGallery({
  works,
  loading,
  fetchError,
  onDismissError,
  onWorkDeleted,
  variant = "podcast",
  enableBatchActions = false
}: Props) {
  const router = useRouter();
  const { getAuthHeaders } = useAuth();
  const { hiddenKey, titlesKey, allowedTypes } = useMemo(() => galleryStorageKeys(variant), [variant]);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setHidden(loadHiddenIds(hiddenKey));
    setTitleOverrides(loadTitles(titlesKey));
  }, [hiddenKey, titlesKey]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const [renameJobId, setRenameJobId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [rssChannels, setRssChannels] = useState<RssChannel[]>([]);
  const [rssLoading, setRssLoading] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishSuccess, setPublishSuccess] = useState("");
  const [publishWorkId, setPublishWorkId] = useState("");
  const [publishChannelId, setPublishChannelId] = useState("");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishSummary, setPublishSummary] = useState("");
  const [publishNotes, setPublishNotes] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [confirmRepublish, setConfirmRepublish] = useState(false);
  const [publicationsByJobId, setPublicationsByJobId] = useState<Record<string, RssPublication[]>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const srcCache = useRef<Record<string, string>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [progress01, setProgress01] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [hydratedDurationSec, setHydratedDurationSec] = useState<Record<string, number>>({});
  const durationFetchRef = useRef<Set<string>>(new Set());
  const durationResolvedRef = useRef<Set<string>>(new Set());
  const [playErrorById, setPlayErrorById] = useState<Record<string, string>>({});

  const items = useMemo((): PodcastWorkRow[] => {
    const list = works.filter((w) => {
      if (!w.id || hidden.has(w.id)) return false;
      if (allowedTypes === null) return true;
      return allowedTypes.has(String(w.type || ""));
    });
    return list.map((w) => ({
      ...w,
      displayTitle: (w.id && titleOverrides[w.id]) || w.title || w.id || "未命名"
    }));
  }, [works, hidden, titleOverrides, allowedTypes]);

  useEffect(() => {
    const ids = items.map((x) => String(x.id || "").trim()).filter(Boolean);
    if (ids.length === 0) {
      setPublicationsByJobId({});
      return;
    }
    let canceled = false;
    void (async () => {
      try {
        const rows = await listRssPublicationsByJobIds(ids);
        if (!canceled) setPublicationsByJobId(rows);
      } catch {
        if (!canceled) setPublicationsByJobId({});
      }
    })();
    return () => {
      canceled = true;
    };
  }, [items]);

  useEffect(() => {
    for (const w of items) {
      const id = w.id;
      if (!id) continue;
      if (typeof w.audioDurationSec === "number" && Number.isFinite(w.audioDurationSec) && w.audioDurationSec > 0) continue;
      if (durationResolvedRef.current.has(id)) continue;
      if (durationFetchRef.current.has(id)) continue;
      durationFetchRef.current.add(id);
      void (async () => {
        try {
          const res = await fetch(`/api/jobs/${id}`, { cache: "no-store", headers: { ...getAuthHeaders() } });
          const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (!res.ok) {
            durationResolvedRef.current.add(id);
            return;
          }
          const result = (row.result || {}) as Record<string, unknown>;
          const ds = result.audio_duration_sec;
          if (typeof ds === "number" && Number.isFinite(ds) && ds > 0) {
            setHydratedDurationSec((prev) => ({ ...prev, [id]: ds }));
            durationResolvedRef.current.add(id);
            return;
          }
          const hex = String(result.audio_hex || "").trim();
          if (!hex) {
            durationResolvedRef.current.add(id);
            return;
          }
          const url = hexToMp3DataUrl(hex);
          const a = document.createElement("audio");
          a.preload = "metadata";
          a.src = url;
          await new Promise<void>((resolve) => {
            const done = () => {
              a.removeAttribute("src");
              a.load();
              resolve();
            };
            a.addEventListener("loadedmetadata", () => {
              if (Number.isFinite(a.duration) && a.duration > 0) {
                setHydratedDurationSec((prev) => ({ ...prev, [id]: a.duration }));
              }
              durationResolvedRef.current.add(id);
              done();
            });
            a.addEventListener("error", () => {
              durationResolvedRef.current.add(id);
              done();
            });
          });
        } finally {
          durationFetchRef.current.delete(id);
        }
      })();
    }
  }, [items, getAuthHeaders]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (menuWrapRef.current && !menuWrapRef.current.contains(t)) setMenuOpenId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const el = audioEl;
    if (!el) return;
    const onTime = () => {
      const d = el.duration;
      const t = el.currentTime;
      setDurationSec(Number.isFinite(d) ? d : 0);
      setProgress01(d && Number.isFinite(d) && d > 0 ? t / d : 0);
    };
    const onEnded = () => {
      setActiveJobId(null);
      setIsPlayingAudio(false);
      setProgress01(0);
    };
    const onMeta = () => {
      const d = el.duration;
      setDurationSec(Number.isFinite(d) ? d : 0);
    };
    const onPlay = () => setIsPlayingAudio(true);
    const onPause = () => setIsPlayingAudio(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [audioEl]);

  const ensureSrc = useCallback(async (jobId: string): Promise<string | null> => {
    if (srcCache.current[jobId]) return srcCache.current[jobId]!;
    const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store", headers: { ...getAuthHeaders() } });
    const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return null;
    const result = (row.result || {}) as Record<string, unknown>;
    const hex = String(result.audio_hex || "").trim();
    if (!hex) return null;
    const url = hexToMp3DataUrl(hex);
    srcCache.current[jobId] = url;
    return url;
  }, [getAuthHeaders]);

  const togglePlay = useCallback(
    async (jobId: string) => {
      const el = audioRef.current;
      if (!el) {
        setPlayErrorById((prev) => ({ ...prev, [jobId]: "播放器未就绪" }));
        return;
      }
      setPlayErrorById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      if (activeJobId === jobId) {
        if (el.paused) void el.play().catch((err) => setPlayErrorById((p) => ({ ...p, [jobId]: String(err instanceof Error ? err.message : err) })));
        else el.pause();
        return;
      }
      setAudioLoadingId(jobId);
      try {
        const url = await ensureSrc(jobId);
        if (!url) {
          setPlayErrorById((prev) => ({ ...prev, [jobId]: "暂无可播放音频，请稍后在创作记录中查看是否生成完成" }));
          return;
        }
        el.pause();
        el.src = url;
        setActiveJobId(jobId);
        setProgress01(0);
        await el.play().catch((err) => {
          setPlayErrorById((prev) => ({
            ...prev,
            [jobId]: err instanceof Error ? err.message : "无法播放（浏览器策略或格式问题）"
          }));
        });
      } catch (e) {
        setPlayErrorById((prev) => ({
          ...prev,
          [jobId]: e instanceof Error ? e.message : "加载音频失败"
        }));
      } finally {
        setAudioLoadingId(null);
      }
    },
    [ensureSrc, activeJobId]
  );

  const onDownload = useCallback(async (row: PodcastWorkRow) => {
    if (!row.id) return;
    setZipBusy(row.id);
    try {
      await downloadJobBundleZip({ jobId: row.id, title: row.displayTitle || row.title || row.id });
    } catch {
      // silent; could surface toast
    } finally {
      setZipBusy(null);
      setMenuOpenId(null);
    }
  }, []);

  function downloadLabelForWorkType(type: string | undefined): string {
    return String(type || "") === "script_draft" ? "下载（文稿·配图）" : "下载（音频·文稿·配图）";
  }

  const commitRename = useCallback(() => {
    if (!renameJobId) return;
    const jobId = renameJobId;
    const name = renameDraft.trim();
    setTitleOverrides((prev) => {
      const next = { ...prev };
      if (!name) delete next[jobId];
      else next[jobId] = name;
      saveTitles(titlesKey, next);
      return next;
    });
    setRenameJobId(null);
  }, [renameJobId, renameDraft, titlesKey]);

  const openRename = useCallback((jobId: string, current: string) => {
    setRenameJobId(jobId);
    setRenameDraft(current);
    setMenuOpenId(null);
    setDeleteConfirmId(null);
  }, []);

  const confirmDelete = useCallback(
    async (jobId: string) => {
      setDeleteBusyId(jobId);
      setDeleteError(null);
      try {
        const maxAttempts = 3;
        const retryDelayMs = [300, 900];
        let res: Response | null = null;
        let data: { success?: boolean; detail?: string; error?: string; already_gone?: boolean } = {};
        let lastErr = "";
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            // 使用 POST /delete 代理：部分环境对 DELETE /api/jobs/:id 返回 405 Method Not Allowed
            res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/delete`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getAuthHeaders() },
              body: "{}"
            });
            const rawText = await res.text();
            data = {};
            if (rawText.trim()) {
              try {
                data = JSON.parse(rawText) as typeof data;
              } catch {
                if (attempt < maxAttempts) {
                  await waitMs(retryDelayMs[attempt - 1] ?? 1200);
                  continue;
                }
                throw new Error(rawText.slice(0, 200) || `删除失败 HTTP ${res.status}`);
              }
            }
            const status = res.status;
            const shouldRetryStatus = status === 408 || status === 429 || status >= 500;
            if (!res.ok && shouldRetryStatus && attempt < maxAttempts) {
              await waitMs(retryDelayMs[attempt - 1] ?? 1200);
              continue;
            }
            break;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
            if (attempt < maxAttempts) {
              await waitMs(retryDelayMs[attempt - 1] ?? 1200);
              continue;
            }
            throw err;
          }
        }
        if (!res) {
          throw new Error(lastErr || "删除请求失败");
        }
        const detailLower = String(data.detail ?? "").toLowerCase();
        const looksLikeNotFound =
          res.status === 404 ||
          detailLower.includes("not_found") ||
          detailLower.includes("not found") ||
          detailLower.includes("job_not_found");
        if (looksLikeNotFound || data.already_gone === true) {
          setTitleOverrides((prev) => {
            const next = { ...prev };
            delete next[jobId];
            saveTitles(titlesKey, next);
            return next;
          });
          setHidden((prev) => {
            if (!prev.has(jobId)) return prev;
            const next = new Set(prev);
            next.delete(jobId);
            saveHiddenIds(hiddenKey, next);
            return next;
          });
          delete srcCache.current[jobId];
          setHydratedDurationSec((prev) => {
            const next = { ...prev };
            delete next[jobId];
            return next;
          });
          durationResolvedRef.current.delete(jobId);
          durationFetchRef.current.delete(jobId);
          if (activeJobId === jobId) {
            audioRef.current?.pause();
            setActiveJobId(null);
            setIsPlayingAudio(false);
            setProgress01(0);
          }
          setPlayErrorById((prev) => {
            const next = { ...prev };
            delete next[jobId];
            return next;
          });
          setDeleteConfirmId(null);
          onWorkDeleted?.();
          return;
        }
        if (!res.ok) {
          const d = data.detail;
          const detailStr =
            typeof d === "string" ? d : d !== undefined && d !== null ? JSON.stringify(d) : "";
          const msg = detailStr || String(data.error || "") || `删除失败 HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (data.success === false) {
          const d = data.detail;
          const detailStr =
            typeof d === "string" ? d : d !== undefined && d !== null ? JSON.stringify(d) : "";
          throw new Error(detailStr || String(data.error || "删除失败"));
        }
        setTitleOverrides((prev) => {
          const next = { ...prev };
          delete next[jobId];
          saveTitles(titlesKey, next);
          return next;
        });
        setHidden((prev) => {
          if (!prev.has(jobId)) return prev;
          const next = new Set(prev);
          next.delete(jobId);
          saveHiddenIds(hiddenKey, next);
          return next;
        });
        delete srcCache.current[jobId];
        setHydratedDurationSec((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        durationResolvedRef.current.delete(jobId);
        durationFetchRef.current.delete(jobId);
        if (activeJobId === jobId) {
          audioRef.current?.pause();
          setActiveJobId(null);
          setIsPlayingAudio(false);
          setProgress01(0);
        }
        setPlayErrorById((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        setDeleteConfirmId(null);
        onWorkDeleted?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setDeleteError(msg);
      } finally {
        setDeleteBusyId(null);
      }
    },
    [activeJobId, onWorkDeleted, titlesKey, hiddenKey, getAuthHeaders]
  );

  const requestDelete = useCallback((jobId: string) => {
    setDeleteConfirmId(jobId);
    setDeleteError(null);
    setMenuOpenId(null);
    setRenameJobId(null);
  }, []);

  const pendingDeleteTitle =
    deleteConfirmId != null ? items.find((x) => x.id === deleteConfirmId)?.displayTitle || deleteConfirmId : "";

  const selectedCount = selectedIds.size;
  const selectedRows = items.filter((x) => x.id && selectedIds.has(x.id));

  async function ensureRssChannelsLoaded() {
    if (rssChannels.length > 0 || rssLoading) return;
    setRssLoading(true);
    setPublishError("");
    try {
      const rows = await listRssChannels();
      setRssChannels(rows);
      if (rows.length > 0 && !publishChannelId) setPublishChannelId(String(rows[0]!.id || ""));
    } catch (e) {
      setPublishError(String(e instanceof Error ? e.message : e));
    } finally {
      setRssLoading(false);
    }
  }

  async function openPublish(work: PodcastWorkRow) {
    const id = String(work.id || "").trim();
    if (!id) return;
    setMenuOpenId(null);
    setPublishWorkId(id);
    setPublishTitle(String(work.displayTitle || work.title || "未命名单集"));
    setPublishSummary(String(work.scriptText || "").slice(0, 200));
    setPublishNotes(String(work.scriptText || ""));
    setPublishError("");
    setPublishSuccess("");
    setPublishAt("");
    setConfirmRepublish(false);
    setPublishOpen(true);
    await ensureRssChannelsLoaded();
  }

  async function submitPublish() {
    if (!publishWorkId) return;
    if (!publishChannelId) {
      setPublishError("请先在设置页完成 RSS 发布配置");
      return;
    }
    if (!publishTitle.trim()) {
      setPublishError("单集标题不能为空");
      return;
    }
    setPublishBusy(true);
    setPublishError("");
    setPublishSuccess("");
    try {
      await publishWorkToRss({
        channel_id: publishChannelId,
        job_id: publishWorkId,
        title: publishTitle.trim(),
        summary: publishSummary.trim(),
        show_notes: publishNotes.trim(),
        explicit: false,
        publish_at: publishAt ? new Date(publishAt).toISOString() : undefined,
        force_republish: confirmRepublish
      });
      setPublishSuccess("已写入 RSS，等待小宇宙抓取更新");
      const ids = items.map((x) => String(x.id || "").trim()).filter(Boolean);
      const rows = await listRssPublicationsByJobIds(ids);
      setPublicationsByJobId(rows);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("already_published_same_channel")) {
        setPublishError("该作品已发布到这个频道。若要覆盖发布时间与文案，请勾选“允许重复发布覆盖”后再提交。");
      } else {
        setPublishError(msg);
      }
    } finally {
      setPublishBusy(false);
    }
  }

  async function onReuseTemplate(id: string) {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store", headers: { ...getAuthHeaders() } });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error("读取作品参数失败");
      const jobType = String(row.job_type || "").trim();
      const payload = (row.payload || {}) as Record<string, unknown>;
      const result = (row.result || {}) as Record<string, unknown>;

      if (jobType === "text_to_speech" || jobType === "tts") {
        sessionStorage.setItem(
          TTS_REUSE_TEMPLATE_KEY,
          JSON.stringify({
            text: String(payload.text || result.script_text || "").trim(),
            tts_mode: String(payload.tts_mode || "single").trim(),
            intro_text: String(payload.intro_text || "").trim(),
            outro_text: String(payload.outro_text || "").trim(),
            voice_id: String(payload.voice_id || "").trim(),
            voice_id_1: String(payload.voice_id_1 || "").trim(),
            voice_id_2: String(payload.voice_id_2 || "").trim()
          })
        );
        router.push("/tts");
        return;
      }

      if (jobType === "script_draft") {
        sessionStorage.setItem(
          NOTES_REUSE_TEMPLATE_KEY,
          JSON.stringify({
            notes_notebook: String(payload.notes_notebook || "").trim(),
            text: String(payload.text || "").trim(),
            script_language: String(payload.script_language || "中文").trim(),
            script_target_chars: Number(payload.script_target_chars || 2000)
          })
        );
        router.push("/notes");
        return;
      }

      sessionStorage.setItem(
        PODCAST_REUSE_TEMPLATE_KEY,
        JSON.stringify({
          text: String(payload.text || result.script_text || "").trim(),
          script_target_chars: Number(payload.script_target_chars || 800),
          script_language: String(payload.script_language || "中文").trim(),
          output_mode: String(payload.output_mode || "dialogue").trim(),
          reference_urls: String(payload.source_url || "").trim(),
          intro_text: String(payload.intro_text || "").trim(),
          outro_text: String(payload.outro_text || "").trim()
        })
      );
      router.push("/podcast");
    } catch (e) {
      setPlayErrorById((prev) => ({
        ...prev,
        [id]: `复用模板失败：${e instanceof Error ? e.message : String(e)}`
      }));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function batchDownloadSelected() {
    if (selectedRows.length === 0) return;
    setBatchBusy(true);
    try {
      for (const row of selectedRows) {
        if (!row.id) continue;
        await downloadJobBundleZip({ jobId: row.id, title: row.displayTitle || row.title || row.id });
      }
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div>
      <SmallConfirmModal
        open={deleteConfirmId != null}
        title="删除作品"
        message={`确定删除「${pendingDeleteTitle}」吗？作品会移入回收站；本机显示名称缓存会清除。`}
        confirmLabel="确认删除"
        cancelLabel="取消"
        danger
        busy={deleteConfirmId != null && deleteBusyId === deleteConfirmId}
        busyLabel="删除中…"
        error={deleteError}
        onCancel={() => {
          if (deleteBusyId === deleteConfirmId) return;
          setDeleteConfirmId(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (deleteConfirmId == null || deleteBusyId === deleteConfirmId) return;
          void confirmDelete(deleteConfirmId);
        }}
      />

      <audio
        ref={(node) => {
          audioRef.current = node;
          setAudioEl(node);
        }}
        className="hidden"
        preload="metadata"
        playsInline
      />

      {publishOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-3">
          <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-4 shadow-lg">
            <p className="text-sm font-semibold text-ink">发布到 RSS</p>
            <p className="mt-1 text-xs text-muted">确认后将写入节目源，小宇宙会按抓取节奏收录。</p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-muted">
                频道
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm text-ink"
                  value={publishChannelId}
                  onChange={(e) => setPublishChannelId(e.target.value)}
                >
                  <option value="">{rssLoading ? "加载频道中…" : "请选择频道（先在设置页配置）"}</option>
                  {rssChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted">
                单集标题
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm text-ink"
                  value={publishTitle}
                  onChange={(e) => setPublishTitle(e.target.value)}
                />
              </label>
              <label className="block text-xs text-muted">
                摘要
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm text-ink"
                  rows={2}
                  value={publishSummary}
                  onChange={(e) => setPublishSummary(e.target.value)}
                />
              </label>
              <label className="block text-xs text-muted">
                Show Notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm text-ink"
                  rows={4}
                  value={publishNotes}
                  onChange={(e) => setPublishNotes(e.target.value)}
                />
              </label>
              <label className="block text-xs text-muted">
                定时发布时间（可选）
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm text-ink"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={confirmRepublish}
                  onChange={(e) => setConfirmRepublish(e.target.checked)}
                />
                允许重复发布覆盖（同频道同作品）
              </label>
            </div>
            {publishError ? <p className="mt-2 text-xs text-rose-600">{publishError}</p> : null}
            {publishSuccess ? <p className="mt-2 text-xs text-emerald-700">{publishSuccess}</p> : null}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-fill"
                onClick={() => setPublishOpen(false)}
                disabled={publishBusy}
              >
                关闭
              </button>
              <button
                type="button"
                className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:opacity-95 disabled:opacity-60"
                onClick={() => void submitPublish()}
                disabled={publishBusy}
              >
                {publishBusy ? "发布中…" : "确认发布"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fetchError ? (
        <p className="mb-2 text-sm text-rose-600">
          {fetchError}
          {onDismissError ? (
            <button type="button" className="ml-2 underline" onClick={onDismissError}>
              清除
            </button>
          ) : null}
        </p>
      ) : null}

      {enableBatchActions && items.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-fill/50 px-3 py-2 text-xs">
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill"
            onClick={() => {
              setBatchMode((v) => !v);
              if (batchMode) setSelectedIds(new Set());
            }}
          >
            {batchMode ? "退出批量模式" : "批量模式"}
          </button>
          {batchMode ? (
            <>
              <span className="text-muted">已选 {selectedCount} 项</span>
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill"
                onClick={() => setSelectedIds(new Set(items.map((x) => String(x.id || "")).filter(Boolean)))}
              >
                全选当前页
              </button>
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill disabled:opacity-50"
                disabled={selectedCount === 0 || batchBusy}
                onClick={() => void batchDownloadSelected()}
              >
                {batchBusy ? "正在批量下载…" : "批量下载"}
              </button>
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill"
                onClick={() => setSelectedIds(new Set())}
              >
                清空选择
              </button>
            </>
          ) : (
            <span className="text-muted">用于批量下载当前列表作品</span>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-line bg-fill/50 py-10 text-center text-sm text-muted">
          正在加载作品，请稍候…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-fill/50 py-14 text-center text-sm text-muted">
          {variant === "tts"
            ? "暂无文本转语音作品；合成成功后将出现在此列表"
            : variant === "notes"
              ? "还没有从笔记生成的节目；在笔记播客里生成底稿成功后，会出现在这里"
              : variant === "notes_studio"
                ? "暂无笔记播客作品；在本页生成播客或文章成功后将出现在此列表"
                : variant === "all"
                  ? "暂无已完成作品；生成成功后将出现在这里，也可在「我的作品」中统一管理"
                  : "暂无 AI 播客成片；生成成功后将出现在此列表"}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((w) => {
            const id = w.id!;
            const isScriptDraft = String(w.type || "") === "script_draft";
            const isActive = activeJobId === id;
            const prog = isActive ? progress01 : 0;
            const baseSec =
              typeof w.audioDurationSec === "number" && Number.isFinite(w.audioDurationSec) && w.audioDurationSec > 0
                ? w.audioDurationSec
                : hydratedDurationSec[id];
            const totalSecForLabel =
              isActive && durationSec > 0 && Number.isFinite(durationSec)
                ? durationSec
                : baseSec !== undefined && Number.isFinite(baseSec)
                  ? baseSec
                  : undefined;
            const durationLine = totalSecForLabel !== undefined ? formatClock(totalSecForLabel) : "—";
            const durationCaption = isScriptDraft ? "文章出稿（无音频）" : `时长 ${durationLine}`;
            const created = w.createdAt ? new Date(w.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
            const publications = publicationsByJobId[id] || [];
            const publishedText = publications.length > 0 ? `已发布 ${publications.length} 次 · ${publications[0]?.channel_title || ""}` : "";
            const publishActionText = publications.length > 0 ? "已发布" : "发布";

            return (
              <li
                key={id}
                className="flex w-full max-w-full flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm"
              >
                {enableBatchActions && batchMode ? (
                  <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-3 py-1.5 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(id)}
                      onChange={() => toggleSelect(id)}
                    />
                    选择此作品
                  </label>
                ) : null}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-fill to-fill">
                  {w.coverImage ? (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted">无配图</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={coverImageSrc(w.coverImage)}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={(e) => {
                          const el = e.target as HTMLImageElement;
                          const orig = String(w.coverImage || "").trim();
                          if (orig && el.src.includes("/api/image-proxy") && !el.dataset.fallback) {
                            el.dataset.fallback = "1";
                            el.src = orig;
                            return;
                          }
                          el.style.display = "none";
                        }}
                      />
                    </>
                  ) : (
                    <div className="flex h-full min-h-[3rem] items-center justify-center text-[10px] text-muted">无配图</div>
                  )}
                </div>

                <div className="flex min-h-[4.25rem] shrink-0 flex-row items-center gap-2 border-t border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-tight text-ink" title={w.displayTitle}>
                      {w.displayTitle}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted" title={durationCaption}>
                      {durationCaption}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted" title={created}>
                      {created}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0">
                    {!isScriptDraft ? (
                      <CircularPlayControl
                        playing={isActive && isPlayingAudio}
                        progress={prog}
                        disabled={audioLoadingId === id}
                        onClick={() => void togglePlay(id)}
                      />
                    ) : null}
                    <div className="relative" ref={menuOpenId === id ? menuWrapRef : undefined}>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
                        aria-label="更多"
                        onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
                      >
                        <span className="text-base leading-none">⋯</span>
                      </button>
                      {menuOpenId === id ? (
                        <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[9.5rem] rounded-md border border-line bg-white py-0.5 text-[11px] shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-40"
                            disabled={zipBusy === id}
                            onClick={() => void onDownload(w)}
                          >
                            {zipBusy === id ? "正在打包…" : downloadLabelForWorkType(w.type)}
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-fill"
                            onClick={() => openRename(id, w.displayTitle)}
                          >
                            修改名称
                          </button>
                          {!isScriptDraft ? (
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left hover:bg-fill"
                              onClick={() => void openPublish(w)}
                            >
                              {publishActionText}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                            onClick={() => requestDelete(id)}
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {renameJobId === id ? (
                  <div className="border-t border-line px-3 py-2">
                    <InlineTextPrompt
                      open
                      title="作品名称"
                      value={renameDraft}
                      onChange={setRenameDraft}
                      onSubmit={commitRename}
                      onCancel={() => setRenameJobId(null)}
                      placeholder="输入显示名称"
                    />
                  </div>
                ) : null}
                {playErrorById[id] ? (
                  <p
                    className="border-t border-rose-100 bg-rose-50/90 px-2 py-0.5 text-[9px] leading-tight text-rose-700"
                    role="status"
                  >
                    {playErrorById[id]}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-fill/30 px-2 py-1.5 text-[11px]">
                  {!isScriptDraft ? (
                    <button
                      type="button"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
                      disabled={audioLoadingId === id}
                      onClick={() => void togglePlay(id)}
                    >
                      {isActive && isPlayingAudio ? "暂停" : "播放"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:opacity-50"
                    disabled={zipBusy === id}
                    onClick={() => void onDownload(w)}
                  >
                    {zipBusy === id ? "正在打包…" : "下载"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                    onClick={() => void onReuseTemplate(id)}
                  >
                    复用
                  </button>
                  {!isScriptDraft ? (
                    <button
                      type="button"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                      onClick={() => void openPublish(w)}
                    >
                      {publishActionText}
                    </button>
                  ) : null}
                  {publications.length > 0 ? (
                    <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{publishedText}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
