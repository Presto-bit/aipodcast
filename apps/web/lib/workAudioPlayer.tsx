"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { hexToMp3DataUrl } from "./audioHex";
import { coerceJobResult } from "./coerceJobResult";
import { useAuth } from "./auth";
import { APP_SIDEBAR_COLLAPSED_KEY, APP_SIDEBAR_COLLAPSE_EVENT, APP_SIDEBAR_TOGGLE_EVENT } from "./appSidebarCollapse";
import { readLocalStorageScoped } from "./userScopedStorage";
import { SIDEBAR_COLLAPSED_STORAGE } from "./appShellLayout";

const APP_NAV_SIDEBAR_PX_EXPANDED = 232;
const APP_NAV_SIDEBAR_PX_COLLAPSED = 72;

function readAppNavSidebarInsetPx(): number {
  try {
    return readLocalStorageScoped(APP_SIDEBAR_COLLAPSED_KEY) === SIDEBAR_COLLAPSED_STORAGE
      ? APP_NAV_SIDEBAR_PX_COLLAPSED
      : APP_NAV_SIDEBAR_PX_EXPANDED;
  } catch {
    return APP_NAV_SIDEBAR_PX_EXPANDED;
  }
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** DevTools 过滤：`[fym:work-audio]` */
const WORK_AUDIO_LOG = "[fym:work-audio]";

function summarizeAudioSrcForLog(src: string | null | undefined): string {
  const s = String(src || "").trim();
  if (!s) return "(empty)";
  if (s.startsWith("data:")) {
    const i = s.indexOf(",");
    const head = i >= 0 ? s.slice(0, Math.min(i + 1 + 28, s.length)) : s.slice(0, 48);
    return `${head}… totalLen=${s.length}`;
  }
  if (s.startsWith("blob:")) {
    return `blob:…${s.slice(-16)} len=${s.length}`;
  }
  try {
    const u = new URL(s, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    const tail = u.search ? `${u.pathname}?…` : u.pathname;
    const out = `${u.origin}${tail}`;
    return out.length <= 140 ? out : `${out.slice(0, 140)}…`;
  } catch {
    return s.length <= 100 ? s : `${s.slice(0, 100)}…`;
  }
}

function mediaErrorCodeLabel(code: number | undefined): string {
  if (code == null || code === 0) return "none_or_unknown";
  if (code === MediaError.MEDIA_ERR_ABORTED) return "MEDIA_ERR_ABORTED";
  if (code === MediaError.MEDIA_ERR_NETWORK) return "MEDIA_ERR_NETWORK";
  if (code === MediaError.MEDIA_ERR_DECODE) return "MEDIA_ERR_DECODE";
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return "MEDIA_ERR_SRC_NOT_SUPPORTED";
  return `code_${code}`;
}

export type WorkAudioToggleMeta = {
  displayTitle: string;
  /** 开始播放或切歌后跳转到该秒（Shownotes / 章节跳转） */
  seekSeconds?: number;
  /** 全站官方播客模板：不要求当前用户为任务所有者 */
  usePodcastPublicTemplateListen?: boolean;
};

export type WorkAudioPlayerContextValue = {
  activeJobId: string | null;
  activeDisplayTitle: string;
  isPlaying: boolean;
  progress01: number;
  durationSec: number;
  loadingJobId: string | null;
  playError: string | null;
  togglePlay: (jobId: string, meta: WorkAudioToggleMeta) => Promise<void>;
  pause: () => void;
  resume: () => void;
  skipSeconds: (deltaSec: number) => void;
  /** 当前正在播放且为同一 job 时，将进度跳到绝对秒数 */
  seekForActiveJob: (targetSec: number) => void;
  dismiss: () => void;
  dismissIfJob: (jobId: string) => void;
  clearCachedAudioSrc: (jobId: string) => void;
};

const WorkAudioPlayerContext = createContext<WorkAudioPlayerContextValue | null>(null);

export function useWorkAudioPlayer(): WorkAudioPlayerContextValue {
  const v = useContext(WorkAudioPlayerContext);
  if (!v) throw new Error("useWorkAudioPlayer 必须在 WorkAudioPlayerProvider 内使用");
  return v;
}

export function WorkAudioPlayerProvider({ children }: { children: ReactNode }) {
  const { getAuthHeaders } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const srcCache = useRef<Record<string, string>>({});
  /** 跨域音频拉成 blob 时登记，便于 revoke */
  const blobUrlByJobId = useRef<Record<string, string>>({});

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeDisplayTitle, setActiveDisplayTitle] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress01, setProgress01] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  /** 新开始播放或切换曲目时默认为收起 */
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockInsetLeftPx, setDockInsetLeftPx] = useState(APP_NAV_SIDEBAR_PX_EXPANDED);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  const stopAndClearAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch {
      // ignore
    }
  }, []);

  const dismiss = useCallback(() => {
    stopAndClearAudio();
    for (const k of Object.keys(blobUrlByJobId.current)) {
      try {
        URL.revokeObjectURL(blobUrlByJobId.current[k]!);
      } catch {
        // ignore
      }
      delete blobUrlByJobId.current[k];
      delete srcCache.current[k];
    }
    setActiveJobId(null);
    setActiveDisplayTitle("");
    setIsPlaying(false);
    setProgress01(0);
    setDurationSec(0);
    setPlayError(null);
    setLoadingJobId(null);
    setDockExpanded(false);
  }, [stopAndClearAudio]);

  const dismissIfJob = useCallback(
    (jobId: string) => {
      if (activeJobId !== jobId) return;
      dismiss();
    },
    [activeJobId, dismiss]
  );

  const clearCachedAudioSrc = useCallback((jobId: string) => {
    const blob = blobUrlByJobId.current[jobId];
    if (blob) {
      try {
        URL.revokeObjectURL(blob);
      } catch {
        // ignore
      }
      delete blobUrlByJobId.current[jobId];
    }
    delete srcCache.current[jobId];
  }, []);

  const wrapRemoteAudioAsBlobIfNeeded = useCallback(async (jobId: string, directUrl: string): Promise<string | null> => {
    if (!directUrl || directUrl.startsWith("data:") || directUrl.startsWith("blob:")) return directUrl;
    if (typeof window === "undefined") return directUrl;
    let remote: URL;
    try {
      remote = new URL(directUrl, window.location.href);
    } catch {
      return null;
    }
    if (remote.origin === window.location.origin) return directUrl;
    try {
      const r = await fetch(remote.toString(), { mode: "cors", credentials: "omit", cache: "no-store" });
      if (!r.ok) return directUrl;
      const blob = await r.blob();
      if (!blob?.size) return directUrl;
      const ct = (blob.type || "").toLowerCase();
      if (ct.includes("text/html") || ct.includes("application/json") || ct.includes("xml")) {
        return directUrl;
      }
      const prev = blobUrlByJobId.current[jobId];
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          // ignore
        }
      }
      const obj = URL.createObjectURL(blob);
      blobUrlByJobId.current[jobId] = obj;
      return obj;
    } catch {
      return directUrl;
    }
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
      dismiss();
    };
    const onMeta = () => {
      const d = el.duration;
      setDurationSec(Number.isFinite(d) ? d : 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
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
  }, [audioEl, dismiss]);

  useEffect(() => {
    function syncDockInset() {
      setDockInsetLeftPx(readAppNavSidebarInsetPx());
    }
    syncDockInset();
    window.addEventListener(APP_SIDEBAR_TOGGLE_EVENT, syncDockInset);
    window.addEventListener(APP_SIDEBAR_COLLAPSE_EVENT, syncDockInset);
    window.addEventListener("storage", syncDockInset);
    return () => {
      window.removeEventListener(APP_SIDEBAR_TOGGLE_EVENT, syncDockInset);
      window.removeEventListener(APP_SIDEBAR_COLLAPSE_EVENT, syncDockInset);
      window.removeEventListener("storage", syncDockInset);
    };
  }, []);

  const dockVisible = activeJobId != null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("main-content");
    if (!el) return;
    if (dockVisible) {
      el.style.paddingBottom = "max(4.25rem, env(safe-area-inset-bottom, 0px))";
    } else {
      el.style.paddingBottom = "";
    }
    return () => {
      el.style.paddingBottom = "";
    };
  }, [dockVisible]);

  const ensureSrc = useCallback(
    async (jobId: string, opts?: { usePodcastPublicTemplateListen?: boolean }): Promise<string | null> => {
      if (srcCache.current[jobId]) return srcCache.current[jobId]!;
      if (opts?.usePodcastPublicTemplateListen) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/podcast-template-listen`, {
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; audio_url?: string };
        if (!res.ok || data.success === false) {
          console.warn(`${WORK_AUDIO_LOG} ensureSrc:template_listen_failed`, {
            jobId,
            httpStatus: res.status,
            success: data.success
          });
          return null;
        }
        const audioUrl = String(data.audio_url || "").trim();
        if (audioUrl) {
          srcCache.current[jobId] = audioUrl;
          return audioUrl;
        }
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:template_listen_no_url`, { jobId });
        return null;
      }
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown> & { detail?: string };
      if (!res.ok) {
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:job_fetch_failed`, {
          jobId,
          httpStatus: res.status,
          detail: row.detail ? String(row.detail).slice(0, 200) : undefined
        });
        return null;
      }
      const result = coerceJobResult(row.result);
      const hex = String(result.audio_hex || "").trim();
      if (hex) {
        const url = hexToMp3DataUrl(hex);
        if (url) {
          srcCache.current[jobId] = url;
          return url;
        }
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:hex_present_but_invalid_data_url`, {
          jobId,
          hexLen: hex.length
        });
      }
      const lr = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/work-listen`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const lj = (await lr.json().catch(() => ({}))) as { success?: boolean; audio_url?: string };
      const fresh = String(lj.audio_url || "").trim();
      if (lr.ok && lj.success !== false && fresh) {
        const playable = await wrapRemoteAudioAsBlobIfNeeded(jobId, fresh);
        if (playable) {
          srcCache.current[jobId] = playable;
          return playable;
        }
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:work_listen_url_unusable`, {
          jobId,
          afterWrap: summarizeAudioSrcForLog(fresh)
        });
      } else if (!lr.ok || lj.success === false || !fresh) {
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:work_listen_skipped_or_empty`, {
          jobId,
          httpStatus: lr.status,
          ok: lr.ok,
          success: lj.success,
          audioUrlLen: fresh.length
        });
      }
      const audioUrl = String(result.audio_url || "").trim();
      if (audioUrl) {
        const playable = await wrapRemoteAudioAsBlobIfNeeded(jobId, audioUrl);
        if (playable) {
          srcCache.current[jobId] = playable;
          return playable;
        }
        console.warn(`${WORK_AUDIO_LOG} ensureSrc:result_audio_url_unusable`, {
          jobId,
          summarized: summarizeAudioSrcForLog(audioUrl)
        });
      }
      console.warn(`${WORK_AUDIO_LOG} ensureSrc:no_playable_src`, {
        jobId,
        hadHex: Boolean(hex),
        hexLen: hex.length,
        resultAudioUrl: summarizeAudioSrcForLog(String(result.audio_url || "")),
        workListenTried: true,
        workListenStatus: lr.status
      });
      return null;
    },
    [getAuthHeaders, wrapRemoteAudioAsBlobIfNeeded]
  );

  const applySeekSeconds = useCallback((el: HTMLAudioElement, sec: number) => {
    const s = Number(sec);
    if (!Number.isFinite(s) || s < 0) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      el.currentTime = Math.min(Math.max(0, s), Math.max(0, d - 0.05));
    } else {
      el.currentTime = Math.max(0, s);
    }
  }, []);

  const seekForActiveJob = useCallback(
    (targetSec: number) => {
      const el = audioRef.current;
      if (!el || !activeJobId) return;
      applySeekSeconds(el, targetSec);
    },
    [activeJobId, applySeekSeconds]
  );

  const togglePlay = useCallback(
    async (jobId: string, meta: WorkAudioToggleMeta) => {
      const el = audioRef.current;
      if (!el) {
        setPlayError("播放器未就绪");
        return;
      }
      setPlayError(null);
      const title = String(meta.displayTitle || "").trim() || jobId;
      const seekSec = meta.seekSeconds;
      const wantsSeek = seekSec != null && Number.isFinite(seekSec);
      if (activeJobId === jobId) {
        if (wantsSeek) {
          applySeekSeconds(el, seekSec as number);
          void el.play().catch((err) =>
            setPlayError(String(err instanceof Error ? err.message : err))
          );
          return;
        }
        if (el.paused) {
          void el.play().catch((err) =>
            setPlayError(String(err instanceof Error ? err.message : err))
          );
        } else {
          el.pause();
        }
        return;
      }
      setLoadingJobId(jobId);
      setDockExpanded(false);
      try {
        const url = await ensureSrc(jobId, {
          usePodcastPublicTemplateListen: Boolean(meta.usePodcastPublicTemplateListen)
        });
        if (!url) {
          setPlayError("暂无可播放音频，请稍后在创作记录中查看是否生成完成");
          return;
        }
        el.pause();
        el.src = url;
        setActiveJobId(jobId);
        setActiveDisplayTitle(title);
        setProgress01(0);
        await el.play().catch((err) => {
          const msg = err instanceof Error ? err.message : "无法播放（浏览器策略或格式问题）";
          console.warn(`${WORK_AUDIO_LOG} play() rejected`, {
            jobId,
            message: msg,
            src: summarizeAudioSrcForLog(url),
            audioReadyState: el.readyState,
            audioNetworkState: el.networkState
          });
          setPlayError(msg);
        });
        if (wantsSeek) {
          const t = seekSec as number;
          const runSeek = () => applySeekSeconds(el, t);
          runSeek();
          if (!Number.isFinite(el.duration) || el.duration <= 0) {
            const onMeta = () => {
              runSeek();
              el.removeEventListener("loadedmetadata", onMeta);
            };
            el.addEventListener("loadedmetadata", onMeta);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "加载音频失败";
        console.warn(`${WORK_AUDIO_LOG} togglePlay:ensureSrc_threw`, { jobId, message: msg });
        setPlayError(msg);
      } finally {
        setLoadingJobId(null);
      }
    },
    [ensureSrc, activeJobId, applySeekSeconds]
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const el = audioRef.current;
    if (!el || !activeJobId) return;
    void el.play().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${WORK_AUDIO_LOG} resume play() rejected`, {
        jobId: activeJobId,
        message: msg,
        src: summarizeAudioSrcForLog(el.currentSrc || el.src)
      });
      setPlayError(msg);
    });
  }, [activeJobId]);

  const skipSeconds = useCallback(
    (deltaSec: number) => {
      const el = audioRef.current;
      if (!el || !activeJobId) return;
      const d = el.duration;
      const next = el.currentTime + deltaSec;
      if (Number.isFinite(d) && d > 0) {
        el.currentTime = Math.min(d, Math.max(0, next));
      } else {
        el.currentTime = Math.max(0, next);
      }
    },
    [activeJobId]
  );

  const value = useMemo<WorkAudioPlayerContextValue>(
    () => ({
      activeJobId,
      activeDisplayTitle,
      isPlaying,
      progress01,
      durationSec,
      loadingJobId,
      playError,
      togglePlay,
      pause,
      resume,
      skipSeconds,
      seekForActiveJob,
      dismiss,
      dismissIfJob,
      clearCachedAudioSrc
    }),
    [
      activeJobId,
      activeDisplayTitle,
      isPlaying,
      progress01,
      durationSec,
      loadingJobId,
      playError,
      togglePlay,
      pause,
      resume,
      skipSeconds,
      seekForActiveJob,
      dismiss,
      dismissIfJob,
      clearCachedAudioSrc
    ]
  );

  const timeLabel =
    durationSec > 0 && Number.isFinite(durationSec)
      ? `${formatClock(durationSec * progress01)} / ${formatClock(durationSec)}`
      : "—";

  return (
    <WorkAudioPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={(node) => {
          audioRef.current = node;
          setAudioEl(node);
        }}
        className="hidden"
        preload="metadata"
        playsInline
        onLoadedData={() => setPlayError(null)}
        onError={() => {
          const el = audioRef.current;
          const me = el?.error;
          const code = me?.code;
          const src = el?.currentSrc || el?.src || "";
          console.warn(`${WORK_AUDIO_LOG} media_element_error`, {
            jobId: activeJobIdRef.current,
            mediaErrorCode: code,
            mediaErrorCodeLabel: mediaErrorCodeLabel(code),
            mediaErrorMessage: me?.message || null,
            networkState: el?.networkState,
            readyState: el?.readyState,
            src: summarizeAudioSrcForLog(src)
          });
          if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
            setPlayError("无法解码该音频（链接可能已失效或格式异常），请刷新后重试或从创作记录重新打开");
          } else if (code === MediaError.MEDIA_ERR_NETWORK) {
            setPlayError("网络错误导致音频加载失败，请检查网络后重试");
          } else {
            setPlayError("音频加载失败，请刷新页面后重试");
          }
        }}
      />
      {dockVisible ? (
        <div
          className="pointer-events-none fixed bottom-0 right-0 z-[420] flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5"
          style={{ left: dockInsetLeftPx }}
          aria-live="polite"
        >
          <div
            className={`pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-line bg-surface/95 px-2 py-1.5 shadow-card backdrop-blur-sm transition-[max-width] duration-200 ${
              dockExpanded ? "w-full max-w-[17rem] sm:max-w-xs" : "w-full max-w-[10.5rem] sm:max-w-[11rem]"
            }`}
          >
            {!dockExpanded ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-soft hover:opacity-95"
                  aria-label={isPlaying ? "暂停" : "播放"}
                  title={isPlaying ? "暂停" : "播放"}
                  onClick={() => (isPlaying ? pause() : resume())}
                >
                  {isPlaying ? (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg className="ml-px h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <p className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight text-ink" title={activeDisplayTitle}>
                  {activeDisplayTitle}
                </p>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
                  aria-label="展开播放器"
                  title="展开"
                  onClick={() => setDockExpanded(true)}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
                  aria-label="关闭播放器"
                  title="关闭"
                  onClick={() => dismiss()}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink" title={activeDisplayTitle}>
                    {activeDisplayTitle}
                  </p>
                  <span className="shrink-0 tabular-nums text-[9px] text-muted">{timeLabel}</span>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
                    aria-label="收起播放器"
                    title="收起"
                    onClick={() => setDockExpanded(false)}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
                    aria-label="关闭播放器"
                    title="关闭"
                    onClick={() => dismiss()}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div
                  className="h-1 w-full cursor-pointer rounded-full bg-track"
                  role="slider"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress01 * 100)}
                  aria-label="播放进度"
                  onClick={(e) => {
                    const el = audioRef.current;
                    if (!el || !activeJobId) return;
                    const d = el.duration;
                    if (!Number.isFinite(d) || d <= 0) return;
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const p = Math.min(1, Math.max(0, x / rect.width));
                    el.currentTime = p * d;
                  }}
                >
                  <div
                    className="h-1 rounded-full bg-brand transition-[width] duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, progress01 * 100))}%` }}
                  />
                </div>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    className="flex h-8 min-w-[2.75rem] shrink-0 items-center justify-center rounded-full border border-line bg-fill px-0.5 text-[9px] font-semibold text-ink hover:bg-track"
                    aria-label="后退 10 秒"
                    title="后退 10 秒"
                    onClick={() => skipSeconds(-10)}
                  >
                    −10s
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-soft hover:opacity-95"
                    aria-label={isPlaying ? "暂停" : "播放"}
                    title={isPlaying ? "暂停" : "播放"}
                    onClick={() => (isPlaying ? pause() : resume())}
                  >
                    {isPlaying ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg className="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="flex h-8 min-w-[2.75rem] shrink-0 items-center justify-center rounded-full border border-line bg-fill px-0.5 text-[9px] font-semibold text-ink hover:bg-track"
                    aria-label="前进 10 秒"
                    title="前进 10 秒"
                    onClick={() => skipSeconds(10)}
                  >
                    +10s
                  </button>
                </div>
                {playError ? (
                  <p className="text-center text-[9px] leading-snug text-danger-ink" role="alert">
                    {playError}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </WorkAudioPlayerContext.Provider>
  );
}
