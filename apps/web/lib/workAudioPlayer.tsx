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
import { unusableInsecureHttpOnHttpsPage } from "./insecureHttpOnHttpsPage";
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

function mediaErrorCodeLabelZh(code: number | undefined): string {
  if (code == null || code === 0) return "未知";
  if (code === MediaError.MEDIA_ERR_ABORTED) return "已中止";
  if (code === MediaError.MEDIA_ERR_NETWORK) return "网络错误";
  if (code === MediaError.MEDIA_ERR_DECODE) return "解码失败";
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return "格式或地址不支持";
  return `错误码 ${code}`;
}

/** 从 API JSON 里摘取可读错误片段（限长） */
function apiErrorSnippet(row: Record<string, unknown>, maxLen = 200): string {
  const d = row.detail;
  const e = row.error;
  let s = "";
  if (typeof d === "string" && d.trim()) s = d.trim();
  else if (d != null && typeof d !== "object") s = String(d).trim();
  else if (typeof e === "string" && e.trim()) s = e.trim();
  else if (e != null && typeof e !== "object") s = String(e).trim();
  return s ? s.slice(0, maxLen) : "";
}

function jsonTopKeys(obj: Record<string, unknown>, max = 32): string[] {
  try {
    return Object.keys(obj).slice(0, max);
  } catch {
    return [];
  }
}

/** 作品播放排障：result 内与音频相关的字段摘要（不含大段 hex） */
function resultAudioDebugSummary(result: Record<string, unknown>): Record<string, unknown> {
  const hex = String(result.audio_hex || "").trim();
  const aurl = String(result.audio_url || "").trim();
  const akey = String(result.audio_object_key || "").trim();
  let audioUrlHost = "";
  try {
    if (aurl.startsWith("http")) {
      audioUrlHost = new URL(aurl, typeof window !== "undefined" ? window.location.href : "http://localhost/").hostname;
    } else if (aurl.startsWith("data:")) {
      audioUrlHost = "(data_url)";
    } else if (aurl.startsWith("blob:")) {
      audioUrlHost = "(blob_url)";
    } else if (aurl) {
      audioUrlHost = "(relative_or_opaque)";
    }
  } catch {
    audioUrlHost = "(url_parse_error)";
  }
  return {
    has_audio_hex: hex.length > 0,
    audio_hex_len: hex.length,
    has_audio_url: aurl.length > 0,
    audio_url_host: audioUrlHost || "(empty)",
    audio_url_summary: summarizeAudioSrcForLog(aurl),
    has_audio_object_key: akey.length > 0,
    audio_object_key_tail: akey.length > 56 ? `…${akey.slice(-56)}` : akey || "(empty)",
    audio_duration_sec: result.audio_duration_sec
  };
}

function jobRowDebugSummary(row: Record<string, unknown>): Record<string, unknown> {
  const r = coerceJobResult(row.result);
  return {
    job_status: String(row.status ?? ""),
    job_type: String(row.job_type ?? ""),
    row_json_keys: jsonTopKeys(row),
    result_json_keys: jsonTopKeys(r),
    audio_hints: resultAudioDebugSummary(r)
  };
}

/** DevTools 过滤：`[fym:work-audio]`；与首参字符串同一行便于检索 */
function logWorkAudioPlay(stage: string, payload: Record<string, unknown>): void {
  console.warn(`${WORK_AUDIO_LOG} ${stage}`, {
    ts: new Date().toISOString(),
    ...payload
  });
}

/** 与 BFF/编排器约定：响应头或 JSON 体中的请求关联 ID */
function requestIdFromResponse(res: Response, body?: Record<string, unknown>): string {
  const h = (res.headers.get("x-request-id") || res.headers.get("X-Request-ID") || "").trim();
  if (h) return h;
  if (body) {
    const a = body.request_id;
    const b = body.requestId;
    if (typeof a === "string" && a.trim()) return a.trim();
    if (typeof b === "string" && b.trim()) return b.trim();
  }
  return "";
}

function assignedSrcKind(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "(empty)";
  if (u.startsWith("data:")) return "data_url";
  if (u.startsWith("blob:")) return "blob_url";
  if (u.startsWith("/")) return "same_origin_path";
  return "absolute_http";
}

type EnsureSrcOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: string; requestId?: string };

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
  const activeDisplayTitleRef = useRef("");
  /** 新开始播放或切换曲目时默认为收起 */
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockInsetLeftPx, setDockInsetLeftPx] = useState(APP_NAV_SIDEBAR_PX_EXPANDED);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    activeDisplayTitleRef.current = activeDisplayTitle;
  }, [activeDisplayTitle]);

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
    if (unusableInsecureHttpOnHttpsPage(directUrl)) {
      logWorkAudioPlay("wrapRemoteAudio_reject_insecure_http_on_https", {
        jobId,
        reason: "mixed_content_audio_src_blocked",
        url: summarizeAudioSrcForLog(remote.toString())
      });
      return null;
    }
    if (remote.origin === window.location.origin) return directUrl;
    const fallbackAfterFetchFailure = (): string | null => {
      if (unusableInsecureHttpOnHttpsPage(directUrl)) {
        logWorkAudioPlay("wrapRemoteAudio_no_https_fallback", {
          jobId,
          reason: "insecure_http_after_fetch_failure",
          url: summarizeAudioSrcForLog(remote.toString())
        });
        return null;
      }
      return directUrl;
    };
    try {
      const r = await fetch(remote.toString(), { mode: "cors", credentials: "omit", cache: "no-store" });
      if (!r.ok) {
        logWorkAudioPlay("wrapRemoteAudio_fetch_non_ok", {
          jobId,
          httpStatus: r.status,
          request_id: requestIdFromResponse(r) || undefined,
          responseContentType: r.headers.get("content-type"),
          url: summarizeAudioSrcForLog(remote.toString())
        });
        return fallbackAfterFetchFailure();
      }
      const blob = await r.blob();
      if (!blob?.size) {
        logWorkAudioPlay("wrapRemoteAudio_empty_blob", {
          jobId,
          request_id: requestIdFromResponse(r) || undefined,
          url: summarizeAudioSrcForLog(remote.toString()),
          reportedBlobType: blob?.type
        });
        return fallbackAfterFetchFailure();
      }
      const ct = (blob.type || "").toLowerCase();
      if (ct.includes("text/html") || ct.includes("application/json") || ct.includes("xml")) {
        logWorkAudioPlay("wrapRemoteAudio_blob_not_audio", {
          jobId,
          request_id: requestIdFromResponse(r) || undefined,
          blobType: blob.type,
          blobSize: blob.size,
          url: summarizeAudioSrcForLog(remote.toString())
        });
        return fallbackAfterFetchFailure();
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
    } catch (e) {
      logWorkAudioPlay("wrapRemoteAudio_fetch_threw", {
        jobId,
        message: e instanceof Error ? e.message : String(e),
        url: summarizeAudioSrcForLog(remote.toString())
      });
      return fallbackAfterFetchFailure();
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
    async (jobId: string, opts?: { usePodcastPublicTemplateListen?: boolean }): Promise<EnsureSrcOutcome> => {
      const fail = (reason: string, rid?: string): EnsureSrcOutcome => ({
        ok: false,
        reason,
        requestId: (rid || "").trim() || undefined
      });

      if (srcCache.current[jobId]) return { ok: true, url: srcCache.current[jobId]! };
      if (opts?.usePodcastPublicTemplateListen) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/podcast-template-listen`, {
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
          success?: boolean;
          audio_url?: string;
        };
        const tplRid = requestIdFromResponse(res, data);
        if (!res.ok || data.success === false) {
          const snip = apiErrorSnippet(data);
          logWorkAudioPlay("ensureSrc:template_listen_failed", {
            jobId,
            request_id: tplRid || undefined,
            httpStatus: res.status,
            responseContentType: res.headers.get("content-type"),
            response_json_keys: jsonTopKeys(data),
            success: data.success,
            snippet: snip || undefined
          });
          return fail(
            `模板试听不可用（HTTP ${res.status}${snip ? `：${snip}` : ""}）。请确认已登录且该内容可访问。`,
            tplRid
          );
        }
        const audioUrl = String(data.audio_url || "").trim();
        if (audioUrl) {
          const playable = await wrapRemoteAudioAsBlobIfNeeded(jobId, audioUrl);
          if (playable) {
            srcCache.current[jobId] = playable;
            return { ok: true, url: playable };
          }
          const mixedTpl = unusableInsecureHttpOnHttpsPage(audioUrl);
          logWorkAudioPlay("ensureSrc:template_listen_url_unusable", {
            jobId,
            request_id: tplRid || undefined,
            httpStatus: res.status,
            summarized: summarizeAudioSrcForLog(audioUrl),
            mixed_insecure_http: mixedTpl
          });
          return fail(
            mixedTpl
              ? "模板试听返回的音频为 http 地址，在 HTTPS 页面无法播放（混合内容）。请检查编排器公网 https 预签名配置。"
              : "模板试听返回的地址无法在浏览器中加载（可能被跨域拦截或内容非有效音频）。",
            tplRid
          );
        }
        logWorkAudioPlay("ensureSrc:template_listen_no_url", {
          jobId,
          request_id: tplRid || undefined,
          httpStatus: res.status,
          response_json_keys: jsonTopKeys(data),
          audio_url_len: String(data.audio_url || "").trim().length
        });
        return fail("模板试听接口未返回音频地址，请稍后重试。", tplRid);
      }
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown> & { detail?: string };
      const jobRid = requestIdFromResponse(res, row);
      if (!res.ok) {
        const snip = apiErrorSnippet(row);
        logWorkAudioPlay("ensureSrc:job_fetch_failed", {
          jobId,
          request_id: jobRid || undefined,
          httpStatus: res.status,
          responseContentType: res.headers.get("content-type"),
          response_json_keys: jsonTopKeys(row),
          snippet: snip || undefined
        });
        return fail(`无法读取作品数据（HTTP ${res.status}${snip ? `：${snip}` : ""}）。若未登录请先登录后再试。`, jobRid);
      }
      const result = coerceJobResult(row.result);
      const hex = String(result.audio_hex || "").trim();
      if (hex) {
        const url = hexToMp3DataUrl(hex);
        if (url) {
          srcCache.current[jobId] = url;
          return { ok: true, url };
        }
        logWorkAudioPlay("ensureSrc:hex_present_but_invalid_data_url", {
          jobId,
          request_id: jobRid || undefined,
          hexLen: hex.length,
          job_row: jobRowDebugSummary(row)
        });
        return fail(
          `作品含音频数据但本地解码失败（数据长度约 ${hex.length} 字符）。请刷新页面或从创作记录重新打开。`,
          jobRid
        );
      }
      const lr = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/work-listen`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const lj = (await lr.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; audio_url?: string };
      const fresh = String(lj.audio_url || "").trim();
      const listenSnip = apiErrorSnippet(lj);
      const listenRid = requestIdFromResponse(lr, lj);
      if (lr.ok && lj.success !== false && fresh) {
        const playable = await wrapRemoteAudioAsBlobIfNeeded(jobId, fresh);
        if (playable) {
          srcCache.current[jobId] = playable;
          return { ok: true, url: playable };
        }
        logWorkAudioPlay("ensureSrc:work_listen_url_unusable", {
          jobId,
          request_id: listenRid || undefined,
          work_listen_http: lr.status,
          listen_json_keys: jsonTopKeys(lj),
          raw_listen_url: summarizeAudioSrcForLog(fresh),
          afterWrap: summarizeAudioSrcForLog(fresh),
          job_row: jobRowDebugSummary(row)
        });
        const mixedListen = unusableInsecureHttpOnHttpsPage(fresh);
        return fail(
          mixedListen
            ? `试听链接为 http 地址，在 HTTPS 页面无法播放（混合内容，常见于内网 MinIO 直链）。请在编排器侧配置公网 HTTPS 的预签名外链（如 OBJECT_PRESIGN_ENDPOINT），或让 work-listen 返回同源/可 CORS 拉取的地址。接口 HTTP ${lr.status}。`
            : `已拿到试听链接但无法在浏览器中加载（可能被跨域拦截或内容非有效音频）。接口 HTTP ${lr.status}。`,
          listenRid
        );
      }
      if (!lr.ok || lj.success === false || !fresh) {
        logWorkAudioPlay("ensureSrc:work_listen_skipped_or_empty", {
          jobId,
          request_id: listenRid || undefined,
          httpStatus: lr.status,
          responseContentType: lr.headers.get("content-type"),
          ok: lr.ok,
          success: lj.success,
          listen_json_keys: jsonTopKeys(lj),
          listen_snippet: listenSnip || undefined,
          audioUrlLen: fresh.length,
          job_row: jobRowDebugSummary(row)
        });
      }
      const audioUrl = String(result.audio_url || "").trim();
      if (audioUrl) {
        const playable = await wrapRemoteAudioAsBlobIfNeeded(jobId, audioUrl);
        if (playable) {
          srcCache.current[jobId] = playable;
          return { ok: true, url: playable };
        }
        logWorkAudioPlay("ensureSrc:result_audio_url_unusable", {
          jobId,
          request_id: listenRid || jobRid || undefined,
          summarized: summarizeAudioSrcForLog(audioUrl),
          work_listen_http: lr.status,
          job_row: jobRowDebugSummary(row)
        });
        const mixedResult = unusableInsecureHttpOnHttpsPage(audioUrl);
        return fail(
          mixedResult
            ? `任务结果中的音频为 http 外链，在 HTTPS 页面无法播放（混合内容）。请让编排器写入公网 https 预签名地址，或修复 work-listen（当前 HTTP ${lr.status}）以提供可试听 URL。摘要：${summarizeAudioSrcForLog(audioUrl)}`
            : `任务结果中的外链音频无法在浏览器中加载（链接可能过期或非 MP3）。摘要：${summarizeAudioSrcForLog(audioUrl)}`,
          listenRid || jobRid
        );
      }
      const tailParts: string[] = [];
      tailParts.push("任务中无可用内嵌音频片段。");
      if (!lr.ok || lj.success === false || !fresh) {
        tailParts.push(
          `试听接口：HTTP ${lr.status}${listenSnip ? `（${listenSnip}）` : !fresh ? "（未返回地址）" : ""}`
        );
      }
      tailParts.push(audioUrl ? "外链字段存在但未能拉取为可播放源。" : "无外链音频字段。");
      tailParts.push("请到作品详情确认是否已生成完成，或稍后重试。");
      const joinedReason = tailParts.join("");
      const aggregateRid = listenRid || jobRid;
      logWorkAudioPlay("ensureSrc:no_playable_src", {
        jobId,
        request_id: aggregateRid || undefined,
        hadHex: Boolean(hex),
        hexLen: hex.length,
        resultAudioUrl: summarizeAudioSrcForLog(String(result.audio_url || "")),
        workListenTried: true,
        workListenStatus: lr.status,
        listen_json_keys: jsonTopKeys(lj),
        listen_snippet: listenSnip || undefined,
        userFacingReason: joinedReason.slice(0, 500),
        job_row: jobRowDebugSummary(row)
      });
      return fail(joinedReason, aggregateRid);
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
      const title = String(meta.displayTitle || "").trim() || jobId;
      const el = audioRef.current;
      if (!el) {
        logWorkAudioPlay("togglePlay:audio_element_missing", { jobId, displayTitle: title });
        setPlayError("播放器未就绪");
        return;
      }
      setPlayError(null);
      const seekSec = meta.seekSeconds;
      const wantsSeek = seekSec != null && Number.isFinite(seekSec);
      if (activeJobId === jobId) {
        if (wantsSeek) {
          applySeekSeconds(el, seekSec as number);
          void el.play().catch((err) => {
            const msg = String(err instanceof Error ? err.message : err);
            logWorkAudioPlay("togglePlay:same_job_play_after_seek_rejected", {
              jobId,
              displayTitle: title,
              message: msg,
              errName: err instanceof Error ? err.name : typeof err,
              seekSeconds: seekSec,
              assignedSrcKind: assignedSrcKind(el.currentSrc || el.src),
              src: summarizeAudioSrcForLog(el.currentSrc || el.src),
              audioReadyState: el.readyState,
              audioNetworkState: el.networkState
            });
            setPlayError(msg);
          });
          return;
        }
        if (el.paused) {
          void el.play().catch((err) => {
            const msg = String(err instanceof Error ? err.message : err);
            logWorkAudioPlay("togglePlay:same_job_resume_rejected", {
              jobId,
              displayTitle: title,
              message: msg,
              errName: err instanceof Error ? err.name : typeof err,
              assignedSrcKind: assignedSrcKind(el.currentSrc || el.src),
              src: summarizeAudioSrcForLog(el.currentSrc || el.src),
              audioReadyState: el.readyState,
              audioNetworkState: el.networkState
            });
            setPlayError(msg);
          });
        } else {
          el.pause();
        }
        return;
      }
      setLoadingJobId(jobId);
      setDockExpanded(false);
      try {
        const ensured = await ensureSrc(jobId, {
          usePodcastPublicTemplateListen: Boolean(meta.usePodcastPublicTemplateListen)
        });
        if (!ensured.ok) {
          const rid = (ensured.requestId || "").trim();
          logWorkAudioPlay("togglePlay:ensure_src_failed", {
            jobId,
            displayTitle: title,
            request_id: rid || undefined,
            usePodcastPublicTemplateListen: Boolean(meta.usePodcastPublicTemplateListen),
            userFacingReason: ensured.reason
          });
          setPlayError(rid ? `${ensured.reason}（request_id: ${rid}）` : ensured.reason);
          return;
        }
        const url = ensured.url;
        el.pause();
        el.src = url;
        setActiveJobId(jobId);
        setActiveDisplayTitle(title);
        setProgress01(0);
        await el.play().catch((err) => {
          const msg = err instanceof Error ? err.message : "无法播放（浏览器策略或格式问题）";
          logWorkAudioPlay("togglePlay:play_after_new_src_rejected", {
            jobId,
            displayTitle: title,
            message: msg,
            errName: err instanceof Error ? err.name : typeof err,
            errStack: err instanceof Error ? err.stack?.slice(0, 600) : undefined,
            intendedSrcKind: assignedSrcKind(url),
            src: summarizeAudioSrcForLog(url),
            assignedSrcKind: assignedSrcKind(el.src || el.currentSrc),
            assignedSrc: summarizeAudioSrcForLog(el.src || el.currentSrc),
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
        logWorkAudioPlay("togglePlay:ensure_src_threw", {
          jobId,
          displayTitle: title,
          message: msg,
          errName: e instanceof Error ? e.name : typeof e,
          errStack: e instanceof Error ? e.stack?.slice(0, 800) : undefined,
          usePodcastPublicTemplateListen: Boolean(meta.usePodcastPublicTemplateListen)
        });
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
      logWorkAudioPlay("resume:play_rejected", {
        jobId: activeJobId,
        displayTitle: activeDisplayTitleRef.current || undefined,
        message: msg,
        errName: err instanceof Error ? err.name : typeof err,
        assignedSrcKind: assignedSrcKind(el.currentSrc || el.src),
        src: summarizeAudioSrcForLog(el.currentSrc || el.src),
        audioReadyState: el.readyState,
        audioNetworkState: el.networkState
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
          const tech = `类型 ${mediaErrorCodeLabelZh(code)}（${mediaErrorCodeLabel(code)}）· networkState=${el?.networkState ?? "?"} · readyState=${el?.readyState ?? "?"}`;
          const srcHint = summarizeAudioSrcForLog(src);
          logWorkAudioPlay("media_element:onError", {
            jobId: activeJobIdRef.current,
            displayTitle: activeDisplayTitleRef.current || undefined,
            assignedSrcKind: assignedSrcKind(src),
            mediaErrorCode: code,
            mediaErrorCodeLabel: mediaErrorCodeLabel(code),
            mediaErrorCodeLabelZh: mediaErrorCodeLabelZh(code),
            mediaErrorMessage: me?.message || null,
            networkState: el?.networkState,
            readyState: el?.readyState,
            src: srcHint,
            currentTime: el?.currentTime,
            paused: el?.paused,
            document_visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
            navigator_onLine: typeof navigator !== "undefined" ? navigator.onLine : undefined
          });
          if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
            setPlayError(
              `无法解码或格式不支持（${tech}）。链接可能已失效；源摘要：${srcHint}。请刷新后重试。`
            );
          } else if (code === MediaError.MEDIA_ERR_NETWORK) {
            setPlayError(`网络错误导致音频加载失败（${tech}）。请检查网络或代理；源摘要：${srcHint}`);
          } else {
            setPlayError(`音频加载失败（${tech}）。请刷新页面；源摘要：${srcHint}`);
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
              <div className="flex min-w-0 flex-col gap-1">
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
                {playError ? (
                  <p
                    className="max-h-24 overflow-y-auto break-words text-[9px] leading-snug text-danger-ink"
                    role="alert"
                    title={playError}
                  >
                    {playError}
                  </p>
                ) : null}
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
                  <p
                    className="max-h-32 overflow-y-auto break-words text-center text-[9px] leading-snug text-danger-ink whitespace-pre-wrap"
                    role="alert"
                    title={playError}
                  >
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
