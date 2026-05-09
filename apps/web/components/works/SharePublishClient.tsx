"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_PROGRAM_SUMMARY_MAX,
  buildSharePublishCopyFromScriptAndPayload,
  clearShareFormDraft,
  computeSharePublishHints,
  defaultSummaryFromJobResult,
  loadShareFormDraft,
  saveShareFormDraft,
  sanitizeShareEpisodeTitle,
  shareFormFieldsDiffer,
  truncateSummaryToAutoMax,
  type ShareFormFields
} from "../../lib/sharePublishDefaults";
import { getBearerAuthHeadersSync, jobEventsSourceUrl } from "../../lib/authHeaders";
import { readLocalStorageScoped, readSessionStorageScoped, writeLocalStorageScoped } from "../../lib/userScopedStorage";
import {
  createJob,
  fetchJobShareAiCopy,
  fetchPersistShareShowNotes,
  fetchPublicShareListen,
  fetchRssPublishEligibility,
  getJob,
  listRssChannels,
  listRssPublicationsByJobIds,
  previewMediaJob,
  publishWorkToRss,
  type RssChannel
} from "../../lib/api";
import type { JobRecord } from "../../lib/types";
import { isJobEventLogOnlyForUi } from "../../lib/jobEventStreamUi";
import { presentJobProgressMessageForUser } from "../../lib/jobProgressUserText";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import { DEFAULT_PUBLISH_PLATFORM_ID, type PublishPlatformId, PUBLISH_PLATFORMS } from "../../lib/publishPlatforms";
import { PUBLISH_PLATFORM_ICON_URL } from "../../lib/publishPlatformAssets";
import { resolveJobScriptBodyText, SCRIPT_TEXT_LIKELY_FULL_MIN_LEN } from "../../lib/jobScriptText";
import { ShowNotesMarkdownPreview } from "../podcast/ShowNotesMarkdownPreview";
import { buildWorksSharePageUrl, rssFeedUrlForSlug } from "../../lib/rssPublicBase";
import { jobResultCoverUrl, workCoverImageSrc } from "../../lib/workCoverImage";
import { blobToDataUrlBase64 } from "../../lib/podcastCoverImage";
import { useAuth, userAccountRef } from "../../lib/auth";
import { formatUnifiedWorksNavMetaLineFromJobRecord } from "../../lib/worksNavMetaLine";
import {
  isWorkDownloadRechargeGateError,
  openSubscriptionWalletTopup,
  WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE
} from "../../lib/workDownloadRechargeGate";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import { useWorkAudioPlayer, type WorkAudioToggleMeta } from "../../lib/workAudioPlayer";
import { WorkHubOverviewPanel, type WorkHubDetailTab } from "./WorkHubOverviewPanel";
import { WorkHubShownotesSection } from "./WorkHubShownotesSection";
import { RssChannelEditor } from "../rss/RssChannelEditor";
import { downloadJobBundleZip, downloadJobManuscriptTxt } from "../../lib/workBundleDownload";
import { SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER as AI_SHOWNOTES_PROMPT_PLACEHOLDER } from "../../lib/shareShownotesAiPrompt";

const RSS_LAST_CHANNEL_STORAGE_KEY = "fym_rss_last_channel_id";

function IconShareClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinejoin="round" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinejoin="round" />
    </svg>
  );
}

function IconShareCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShareExport({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 7 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDownloadBundle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 11 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </svg>
  );
}

type Props = {
  jobId: string;
  /** `work_hub`：作品详情（概览 + 发布分组）；默认与旧版 `/works/share` 一致 */
  layout?: "standalone" | "work_hub";
  /** 仅 `layout === "work_hub"` 时生效；`publish` 对应 URL `?tab=publish`，打开分享弹窗 */
  initialHubTab?: "overview" | "publish";
  /** 站内返回路径（查询参数 `returnTo`）；无效时回退为 /works 或首页 */
  returnTo?: string | null;
};

const PINNED_PUBLISH_PLATFORM_IDS: PublishPlatformId[] = ["xiaoyuzhou", "ximalaya"];
const PINNED_PUBLISH_PLATFORM_SET = new Set<PublishPlatformId>(PINNED_PUBLISH_PLATFORM_IDS);

function sanitizeWorkDetailReturnTo(raw: string | null | undefined, fallback: string): string {
  const t = String(raw ?? "").trim();
  if (!t.startsWith("/") || t.startsWith("//")) return fallback;
  if (t.includes(":")) return fallback;
  return t.split("?")[0].split("#")[0] || fallback;
}

/** 成片可能只有对象存储 URL / key，不一定内联 audio_hex（大文件会省略 hex）。 */
function jobResultHasPlayableAudio(result: Record<string, unknown>): boolean {
  const hex = String(result.audio_hex || "").trim();
  const url = String(result.audio_url || "").trim();
  const key = String(result.audio_object_key || "").trim();
  const durRaw = result.audio_duration_sec;
  let dur = 0;
  if (typeof durRaw === "number" && Number.isFinite(durRaw)) dur = durRaw;
  else if (typeof durRaw === "string" && durRaw.trim()) dur = Number.parseFloat(durRaw);
  return Boolean(hex || url || key || (Number.isFinite(dur) && dur > 0.4));
}

type FormSnapshot = ShareFormFields;

const DRAFT_DEBOUNCE_MS = 600;
const JOB_GEN_PLACEHOLDER = "生成中,请稍等...";
const JOB_GEN_SCRIPT_DRAFT_PLACEHOLDER =
  "文稿排队生成中，通常需数分钟，请勿关闭页面；完成后正文会自动载入。若长时间无进度，可刷新本页。";

type ShareGenContext = {
  payload: Record<string, unknown>;
  displayTitleHint: string;
  titleFallbackRaw: string;
  resultEarly: Record<string, unknown>;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `datetime-local` value in local timezone (YYYY-MM-DDTHH:mm). */
function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 首次打开弹窗且无已选时间时：本地时区的「下一整点」（例如 15:37 → 16:00）。 */
function defaultScheduleDatetimeLocal(): string {
  const d = new Date();
  d.setMilliseconds(0);
  d.setSeconds(0, 0);
  d.setMinutes(0, 0);
  d.setHours(d.getHours() + 1);
  return toDatetimeLocalValue(d);
}

function formatSchedulePreview(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function formatListenClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** 作品详情生成进度条：按任务类型给出粗略预估总时长（秒），避免依赖后端百分比来回跳动 */
function defaultJobGenEstimateSec(jobType: string): number {
  const j = String(jobType || "").toLowerCase();
  if (j.includes("short_video")) return 420;
  if (j === "script_draft") return 420;
  return 540;
}

function formatEtaRoughCn(sec: number): string {
  const s = Math.ceil(Math.max(0, sec));
  if (s < 90) return `${s} 秒`;
  const m = Math.max(1, Math.round(s / 60));
  return `${m} 分钟`;
}

export function SharePublishClient({
  jobId,
  layout = "standalone",
  initialHubTab = "overview",
  returnTo: returnToProp = null
}: Props) {
  const router = useRouter();
  const { user, phone } = useAuth();
  const workAudio = useWorkAudioPlayer();
  const [loadErr, setLoadErr] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [channels, setChannels] = useState<RssChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [showNotes, setShowNotes] = useState("");
  const [notesTab, setNotesTab] = useState<"preview" | "edit" | "ai">("preview");
  const [listenCoverUrl, setListenCoverUrl] = useState("");
  const [sharePublicAudioUrl, setSharePublicAudioUrl] = useState("");
  const [listenDurationSec, setListenDurationSec] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<WorkHubDetailTab>("edit");
  const [shareConfigModalOpen, setShareConfigModalOpen] = useState(
    () => layout === "work_hub" && initialHubTab === "publish"
  );
  const [manuscriptBody, setManuscriptBody] = useState("");
  const [publishAt, setPublishAt] = useState("");
  /** 已确认启用定时发布（开关为开且提交时使用 publishAt）。 */
  const [schedulePublish, setSchedulePublish] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalDraft, setScheduleModalDraft] = useState("");
  const [scheduleModalErr, setScheduleModalErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [hasAudio, setHasAudio] = useState(false);
  /** 首次拉取任务详情完成前，勿把「无音频」提示当成最终态（避免闪错觉与长文案误报）。 */
  const [shareJobHydrated, setShareJobHydrated] = useState(false);
  const [jobType, setJobType] = useState("");
  /** 任务内 script_text 偏短时，先拉 script 工件（与 AI 优化按钮禁用态同步）。 */
  const [scriptResolvePending, setScriptResolvePending] = useState(false);

  const [publishedHint, setPublishedHint] = useState("");
  const initialSnapshotRef = useRef<FormSnapshot | null>(null);
  /** 相对服务端基线（initialSnapshot）是否有未落库的本地编辑；不在进入页面时因旧 localStorage 自动为 true */
  const [sharePublishDirty, setSharePublishDirty] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formReady, setFormReady] = useState(false);
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatformId>(DEFAULT_PUBLISH_PLATFORM_ID);
  const [rssSetupModalOpen, setRssSetupModalOpen] = useState(false);
  const [aiShownotesModalOpen, setAiShownotesModalOpen] = useState(false);
  const [aiShownotesPromptDraft, setAiShownotesPromptDraft] = useState("");
  const [aiShownotesErr, setAiShownotesErr] = useState("");
  const [shareOrigin, setShareOrigin] = useState("");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [rssLinkCopied, setRssLinkCopied] = useState(false);
  /** 大模型生成简介 / Show Notes（与发布 busy 分离） */
  const [shareAiBusy, setShareAiBusy] = useState(false);
  const [showNotesSaveBusy, setShowNotesSaveBusy] = useState(false);
  /** 当前登录用户且有权访问时拉取到的任务；匿名仅有公开试听数据时为空 */
  const [ownerJobRecord, setOwnerJobRecord] = useState<JobRecord | null>(null);
  const [jobLiveProgressMsg, setJobLiveProgressMsg] = useState("");
  /** 每秒递增，驱动「已进行 / 预估剩余」类进度展示（不用服务端百分比，避免来回跳） */
  const [jobGenTick, setJobGenTick] = useState(0);
  /** RSS 发布：服务端与账户/作品计费挂钩；复制上方分享链接不受限 */
  const [rssGate, setRssGate] = useState<
    "idle" | "loading" | "ok" | "blocked" | "err"
  >("idle");
  const [rssGateDetail, setRssGateDetail] = useState("");
  const [audioRegenActive, setAudioRegenActive] = useState(false);
  const [audioRegenProgress, setAudioRegenProgress] = useState(0);
  const [audioRegenMessage, setAudioRegenMessage] = useState("");
  const [regenerateVoiceBusy, setRegenerateVoiceBusy] = useState(false);
  const audioRegenAbortRef = useRef(false);
  const aiShownotesPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const morePlatformsRef = useRef<HTMLDivElement | null>(null);
  const moreMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const [morePlatformsOpen, setMorePlatformsOpen] = useState(false);
  const [moreMenuFixedStyle, setMoreMenuFixedStyle] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const [publishPlatformIconBroken, setPublishPlatformIconBroken] = useState<
    Partial<Record<PublishPlatformId, boolean>>
  >({});
  const [workHubDownloadBusy, setWorkHubDownloadBusy] = useState(false);
  const [workDownloadRechargeModalOpen, setWorkDownloadRechargeModalOpen] = useState(false);

  const shareGenContextRef = useRef<ShareGenContext | null>(null);
  /** 主人进入分享页后至多触发一次「persist 写入 result」的 AI 初稿（Strict Mode 取消时会复位）。 */
  const deferredShareAiOnceRef = useRef(false);
  const ownerJobRecordRef = useRef<JobRecord | null>(null);
  ownerJobRecordRef.current = ownerJobRecord;

  useEffect(() => {
    setShareOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  const sharePageFullUrl =
    buildWorksSharePageUrl(jobId) ||
    (shareOrigin ? `${shareOrigin}/works/share/${encodeURIComponent(jobId)}` : "");

  const copySharePageLink = useCallback(async () => {
    if (!sharePageFullUrl) return;
    try {
      await navigator.clipboard.writeText(sharePageFullUrl);
      setShareLinkCopied(true);
      window.setTimeout(() => setShareLinkCopied(false), 2200);
    } catch {
      window.alert("复制失败，请检查浏览器剪贴板权限。");
    }
  }, [sharePageFullUrl]);

  const rssFeedCopyUrl = useMemo(() => {
    const id = channelId.trim();
    if (!id) return "";
    const ch = channels.find((c) => String(c.id) === id);
    const slug = String(ch?.feed_slug || "").trim();
    return slug ? rssFeedUrlForSlug(slug) : "";
  }, [channels, channelId]);

  const copyRssFeedUrl = useCallback(async () => {
    if (!rssFeedCopyUrl) return;
    try {
      await navigator.clipboard.writeText(rssFeedCopyUrl);
      setRssLinkCopied(true);
      window.setTimeout(() => setRssLinkCopied(false), 2200);
    } catch {
      window.alert("复制失败，请检查浏览器剪贴板权限。");
    }
  }, [rssFeedCopyUrl]);

  const hints = computeSharePublishHints(episodeTitle, summary, showNotes);

  const persistDraft = useCallback(() => {
    if (layout === "standalone") return;
    if (!formReady) return;
    const snap = initialSnapshotRef.current;
    const cur: ShareFormFields = {
      episodeTitle,
      summary,
      showNotes
    };
    if (snap && !shareFormFieldsDiffer(cur, snap)) {
      return;
    }
    saveShareFormDraft(jobId, cur);
  }, [formReady, jobId, episodeTitle, summary, showNotes, layout]);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => persistDraft(), DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [persistDraft]);

  useEffect(() => {
    if (layout === "standalone") {
      setSharePublishDirty(false);
      return;
    }
    if (!formReady) {
      setSharePublishDirty(false);
      return;
    }
    const snap = initialSnapshotRef.current;
    if (!snap) {
      setSharePublishDirty(false);
      return;
    }
    const cur: ShareFormFields = { episodeTitle, summary, showNotes };
    setSharePublishDirty(shareFormFieldsDiffer(cur, snap));
  }, [layout, formReady, episodeTitle, summary, showNotes]);

  const applyJobToForm = useCallback(
    (row: Record<string, unknown>, displayTitleFallback: string) => {
      const result = (row.result || {}) as Record<string, unknown>;
      const jt = String(row.job_type || "").trim();
      setJobType(jt);
      setHasAudio(jobResultHasPlayableAudio(result));

      const storedTitle = (() => {
        try {
          return String(readSessionStorageScoped(`fym_share_display_title:${jobId}`) || "").trim();
        } catch {
          return "";
        }
      })();
      setJobTitle(displayTitleFallback || storedTitle);

      const rawTitle = storedTitle || displayTitleFallback || String(result.title || "").trim();
      const defaultEpisodeTitle = sanitizeShareEpisodeTitle(rawTitle, "").trim().slice(0, 300);
      const sum = defaultSummaryFromJobResult(result);

      const status = String(row["status"] || "");
      const rowIsGenerating = status === "queued" || status === "running";
      const autoSum = String(result.auto_share_summary || "").trim();
      const autoNotes = String(result.auto_share_show_notes || "").trim();
      const hasAutoShareBoth = Boolean(autoSum && autoNotes);

      setEpisodeTitle(defaultEpisodeTitle);

      if (rowIsGenerating && !hasAutoShareBoth) {
        setSummary("");
        setShowNotes("");
        initialSnapshotRef.current = {
          episodeTitle: defaultEpisodeTitle,
          summary: "",
          showNotes: ""
        };
      } else if (rowIsGenerating && hasAutoShareBoth) {
        setSummary(truncateSummaryToAutoMax(autoSum));
        setShowNotes(autoNotes);
        initialSnapshotRef.current = {
          episodeTitle: defaultEpisodeTitle,
          summary: truncateSummaryToAutoMax(autoSum),
          showNotes: autoNotes
        };
      } else {
        setSummary(truncateSummaryToAutoMax(sum));
        setShowNotes("正在生成 Shownotes…");
        initialSnapshotRef.current = {
          episodeTitle: defaultEpisodeTitle,
          summary: truncateSummaryToAutoMax(sum),
          showNotes: "正在生成 Shownotes…"
        };
      }
    },
    [jobId]
  );

  const mergeRunningJobSnapshot = useCallback(
    async (row: JobRecord, canceledRef: { current: boolean }) => {
      const rowRec = row as unknown as Record<string, unknown>;
      const resultEarly = (rowRec.result || {}) as Record<string, unknown>;
      const payload = (rowRec.payload || {}) as Record<string, unknown>;
      const succeeded = row.status === "succeeded";

      setJobType(String(row.job_type || ""));
      setHasAudio(jobResultHasPlayableAudio(resultEarly));

      let rawTitle = "";
      try {
        rawTitle = String(readSessionStorageScoped(`fym_share_display_title:${jobId}`) || "").trim();
      } catch {
        rawTitle = "";
      }
      rawTitle = rawTitle || String(resultEarly.title || "").trim();

      const rawCh = resultEarly.audio_chapters;
      const hasCh =
        Array.isArray(rawCh) &&
        rawCh.length > 0 &&
        rawCh.every((x) => x && typeof x === "object");
      const audioChaptersRaw = hasCh ? (rawCh as Record<string, unknown>[]) : undefined;

      const durRaw = resultEarly.audio_duration_sec;
      const audioDurationSec =
        typeof durRaw === "number" && Number.isFinite(durRaw)
          ? durRaw
          : typeof durRaw === "string" && String(durRaw).trim() !== ""
            ? Number.parseFloat(String(durRaw))
            : null;

      const shortFrom = String(resultEarly.script_text || "").trim();
      let fullScript = shortFrom;
      if (succeeded) {
        if (canceledRef.current) return;
        const showScriptSpinner = shortFrom.length < SCRIPT_TEXT_LIKELY_FULL_MIN_LEN;
        if (showScriptSpinner) setScriptResolvePending(true);
        try {
          fullScript = await resolveJobScriptBodyText(jobId, rowRec, getBearerAuthHeadersSync());
        } catch {
          /* ignore */
        } finally {
          if (!canceledRef.current && showScriptSpinner) setScriptResolvePending(false);
        }
      } else {
        fullScript = shortFrom || String(resultEarly.preview || resultEarly.script_preview || "").trim();
      }

      if (canceledRef.current) return;

      shareGenContextRef.current = {
        payload,
        displayTitleHint: rawTitle,
        titleFallbackRaw: rawTitle,
        resultEarly
      };

      const derived = buildSharePublishCopyFromScriptAndPayload({
        scriptRaw: fullScript,
        payload,
        result: resultEarly,
        displayTitleHint: rawTitle,
        audioChaptersRaw,
        audioDurationSec: Number.isFinite(audioDurationSec as number) ? audioDurationSec : null,
        fallbackTitle: sanitizeShareEpisodeTitle(rawTitle),
        fallbackSummary: defaultSummaryFromJobResult(resultEarly)
      });

      const autoShareS = String(resultEarly.auto_share_summary || "").trim();
      const autoShareN = String(resultEarly.auto_share_show_notes || "").trim();
      const hasAutoSharePair = Boolean(autoShareS && autoShareN);

      if (succeeded) {
        setEpisodeTitle((prev) => {
          const nextEt = prev.trim() ? prev : derived.episodeTitle;
          initialSnapshotRef.current = {
            episodeTitle: nextEt,
            summary: truncateSummaryToAutoMax(derived.summary),
            showNotes: derived.showNotes
          };
          return nextEt;
        });
        setSummary(truncateSummaryToAutoMax(derived.summary));
        setShowNotes(derived.showNotes);
      } else {
        setEpisodeTitle((prev) => (prev.trim() ? prev : derived.episodeTitle));
        if (hasAutoSharePair) {
          setSummary(truncateSummaryToAutoMax(derived.summary));
          setShowNotes(derived.showNotes);
        } else {
          setSummary("");
          setShowNotes("");
        }
      }
      setManuscriptBody(String(fullScript || "").trim());

      const coverFromResult = jobResultCoverUrl(resultEarly);
      if (coverFromResult.trim()) setListenCoverUrl(coverFromResult.trim());

      const durListen = resultEarly.audio_duration_sec;
      let dVal: number | null = null;
      if (typeof durListen === "number" && Number.isFinite(durListen) && durListen > 0) dVal = durListen;
      else if (typeof durListen === "string" && String(durListen).trim()) {
        const n = Number.parseFloat(String(durListen));
        if (Number.isFinite(n) && n > 0) dVal = n;
      }
      if (dVal != null) setListenDurationSec(dVal);
    },
    [jobId]
  );

  useEffect(() => {
    let canceled = false;
    deferredShareAiOnceRef.current = false;
    void (async () => {
      setLoadErr("");
      setShareJobHydrated(false);
      setFormReady(false);
      setManuscriptBody("");
      setScriptResolvePending(false);
      setOwnerJobRecord(null);
      setListenCoverUrl("");
      setSharePublicAudioUrl("");
      setListenDurationSec(null);
      setPublishedHint("");
      setJobLiveProgressMsg("");
      setJobGenTick(0);

      if (layout === "standalone") {
        let pubStandalone: Awaited<ReturnType<typeof fetchPublicShareListen>> = null;
        try {
          pubStandalone = await fetchPublicShareListen(jobId);
        } catch {
          pubStandalone = null;
        }
        if (canceled) return;
        if (!pubStandalone) {
          setLoadErr("无法加载该作品或链接已失效。");
          setShareJobHydrated(true);
          return;
        }
        setListenCoverUrl(String(pubStandalone.cover_image || "").trim());
        setSharePublicAudioUrl(String(pubStandalone.audio_url || "").trim());
        const durS = pubStandalone.audio_duration_sec;
        let dVal: number | null = null;
        if (typeof durS === "number" && Number.isFinite(durS) && durS > 0) dVal = durS;
        setListenDurationSec(dVal);

        setManuscriptBody("");
        setOwnerJobRecord(null);
        setJobType(pubStandalone.job_type || "");
        setJobTitle(pubStandalone.title);
        setHasAudio(Boolean(pubStandalone.audio_url?.trim()));
        const etS = pubStandalone.title.slice(0, 300);
        setEpisodeTitle(etS);
        const sumS = String(pubStandalone.episode_summary || pubStandalone.preview || "").trim();
        setSummary(truncateSummaryToAutoMax(sumS));
        const notesS = String(pubStandalone.show_notes || "").trim();
        setShowNotes(notesS);
        initialSnapshotRef.current = {
          episodeTitle: etS,
          summary: truncateSummaryToAutoMax(sumS),
          showNotes: notesS
        };
        shareGenContextRef.current = null;
        setFormReady(true);
        setShareJobHydrated(true);
        return;
      }

      let row: JobRecord | null = null;
      try {
        row = await getJob(jobId);
      } catch {
        row = null;
      }
      if (canceled) return;

      let pub: Awaited<ReturnType<typeof fetchPublicShareListen>> = null;
      if (!row) {
        try {
          pub = await fetchPublicShareListen(jobId);
        } catch {
          pub = null;
        }
      }
      if (canceled) return;

      if (!row && !pub) {
        setLoadErr("无法加载该作品或链接已失效。");
        setShareJobHydrated(true);
        return;
      }

      if (row) {
        setOwnerJobRecord(row);
        try {
          const displayKey = `fym_share_display_title:${jobId}`;
          let fallback = "";
          try {
            fallback = String(readSessionStorageScoped(displayKey) || "").trim();
          } catch {
            /* ignore */
          }
          applyJobToForm(row as unknown as Record<string, unknown>, fallback);

          const rowRec = row as unknown as Record<string, unknown>;
          const resultEarly = (rowRec.result || {}) as Record<string, unknown>;
          const payload = (rowRec.payload || {}) as Record<string, unknown>;
          const rawTitle =
            (() => {
              try {
                return String(readSessionStorageScoped(displayKey) || "").trim();
              } catch {
                return "";
              }
            })() ||
            fallback ||
            String(resultEarly.title || "").trim();
          const rawCh = resultEarly.audio_chapters;
          const hasCh =
            Array.isArray(rawCh) &&
            rawCh.length > 0 &&
            rawCh.every((x) => x && typeof x === "object");
          const audioChaptersRaw = hasCh ? (rawCh as Record<string, unknown>[]) : undefined;
          const durRaw = resultEarly.audio_duration_sec;
          const audioDurationSec =
            typeof durRaw === "number" && Number.isFinite(durRaw)
              ? durRaw
              : typeof durRaw === "string" && String(durRaw).trim() !== ""
                ? Number.parseFloat(String(durRaw))
                : null;

          const shortFrom = String(resultEarly.script_text || "").trim();
          const needsArtifactPath = shortFrom.length < SCRIPT_TEXT_LIKELY_FULL_MIN_LEN;
          if (needsArtifactPath) {
            setScriptResolvePending(true);
          }
          let fullScript = shortFrom;
          try {
            fullScript = await resolveJobScriptBodyText(jobId, rowRec, getBearerAuthHeadersSync());
          } catch {
            /* ignore */
          } finally {
            if (!canceled) setScriptResolvePending(false);
          }

          if (!canceled) {
            const rowStatus = row.status;
            const rowIsGeneratingLoad = rowStatus === "queued" || rowStatus === "running";
            const autoSLoad = String(resultEarly.auto_share_summary || "").trim();
            const autoNLoad = String(resultEarly.auto_share_show_notes || "").trim();
            const hasAutoBothLoad = Boolean(autoSLoad && autoNLoad);

            shareGenContextRef.current = {
              payload,
              displayTitleHint: rawTitle,
              titleFallbackRaw: rawTitle,
              resultEarly
            };
            const derived = buildSharePublishCopyFromScriptAndPayload({
              scriptRaw: fullScript,
              payload,
              result: resultEarly,
              displayTitleHint: rawTitle,
              audioChaptersRaw,
              audioDurationSec: Number.isFinite(audioDurationSec as number) ? audioDurationSec : null,
              fallbackTitle: sanitizeShareEpisodeTitle(rawTitle),
              fallbackSummary: defaultSummaryFromJobResult(resultEarly)
            });
            setEpisodeTitle((prev) => {
              const nextEt = prev.trim() ? prev : derived.episodeTitle;
              if (rowIsGeneratingLoad && !hasAutoBothLoad) {
                initialSnapshotRef.current = {
                  episodeTitle: nextEt,
                  summary: "",
                  showNotes: ""
                };
              } else {
                initialSnapshotRef.current = { ...derived, episodeTitle: nextEt };
              }
              return nextEt;
            });
            if (rowIsGeneratingLoad && !hasAutoBothLoad) {
              setSummary("");
              setShowNotes("");
            } else {
              setSummary(derived.summary);
              setShowNotes(derived.showNotes);
            }
            setManuscriptBody(String(fullScript || "").trim());
          }

          if (!canceled) setFormReady(true);

          const pubs = await listRssPublicationsByJobIds([jobId]);
          const list = pubs[jobId] || [];
          if (list.length > 0) {
            setPublishedHint(`已发布：${list.map((p) => p.channel_title).join("、")}`);
          } else {
            setPublishedHint("");
          }

          if (!canceled) {
            const jtLower = String(row.job_type || "").trim().toLowerCase();
            const autoS0 = String(resultEarly.auto_share_summary || "").trim();
            const autoN0 = String(resultEarly.auto_share_show_notes || "").trim();
            const hasAutoBoth0 = Boolean(autoS0 && autoN0);
            if (
              !deferredShareAiOnceRef.current &&
              !hasAutoBoth0 &&
              jtLower !== "script_draft" &&
              jobResultHasPlayableAudio(resultEarly)
            ) {
              deferredShareAiOnceRef.current = true;
              void (async () => {
                try {
                  if (canceled) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const out = await fetchJobShareAiCopy(jobId, { persist: true });
                  if (canceled || !out.success) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const sum = String(out.summary ?? "").trim();
                  const notes = String(out.show_notes ?? "").trim();
                  if (!sum && !notes) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const snap = initialSnapshotRef.current;
                  if (snap) {
                    initialSnapshotRef.current = {
                      episodeTitle: snap.episodeTitle,
                      summary: truncateSummaryToAutoMax(sum || snap.summary),
                      showNotes: notes || snap.showNotes
                    };
                  }
                  if (sum) setSummary(truncateSummaryToAutoMax(sum));
                  if (notes) setShowNotes(notes);
                  try {
                    const fresh = await getJob(jobId);
                    if (!canceled && fresh) setOwnerJobRecord(fresh);
                  } catch {
                    /* ignore */
                  }
                } catch {
                  deferredShareAiOnceRef.current = false;
                }
              })();
            }
          }
        } catch (e) {
          if (!canceled) setLoadErr(String(e instanceof Error ? e.message : e));
        }
      } else if (pub) {
        setManuscriptBody("");
        setOwnerJobRecord(null);
        setListenCoverUrl(String(pub.cover_image || "").trim());
        setSharePublicAudioUrl(String(pub.audio_url || "").trim());
        const durP = pub.audio_duration_sec;
        let dPub: number | null = null;
        if (typeof durP === "number" && Number.isFinite(durP) && durP > 0) dPub = durP;
        setListenDurationSec(dPub);

        setJobType(pub.job_type || "");
        setJobTitle(pub.title);
        setHasAudio(Boolean(pub.audio_url?.trim()));
        const et = pub.title.slice(0, 300);
        setEpisodeTitle(et);
        const sumP = String(pub.episode_summary || pub.preview || "").trim();
        setSummary(truncateSummaryToAutoMax(sumP));
        setShowNotes(String(pub.show_notes || "").trim());
        const notesP = String(pub.show_notes || "").trim();
        initialSnapshotRef.current = {
          episodeTitle: et,
          summary: truncateSummaryToAutoMax(sumP),
          showNotes: notesP
        };
        shareGenContextRef.current = null;
        setFormReady(true);
      }

      if (!canceled) setShareJobHydrated(true);
    })();
    return () => {
      canceled = true;
    };
  }, [jobId, layout, applyJobToForm]);

  useEffect(() => {
    if (layout !== "work_hub" || !shareJobHydrated || !formReady) return;
    const row0 = ownerJobRecordRef.current;
    if (!row0 || (row0.status !== "queued" && row0.status !== "running")) return;

    const canceledRef = { current: false };
    let es: EventSource | null = null;
    try {
      es = new EventSource(jobEventsSourceUrl(jobId, 0));
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") return;
          if (isJobEventLogOnlyForUi(data.type)) {
            return;
          }
          const msg = String(data.message || "").trim();
          if (msg) setJobLiveProgressMsg(presentJobProgressMessageForUser(msg));
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
      };
    } catch {
      es = null;
    }

    void (async () => {
      while (!canceledRef.current) {
        try {
          const row = await getJob(jobId);
          if (canceledRef.current) break;
          setOwnerJobRecord(row);
          await mergeRunningJobSnapshot(row, canceledRef);
          const st = row.status;
          if (st === "succeeded") {
            try {
              const pubs = await listRssPublicationsByJobIds([jobId]);
              if (!canceledRef.current) {
                const list = pubs[jobId] || [];
                setPublishedHint(list.length > 0 ? `已发布：${list.map((p) => p.channel_title).join("、")}` : "");
              }
            } catch {
              /* ignore */
            }
            const rowRec = row as unknown as Record<string, unknown>;
            const resultEarly = (rowRec.result || {}) as Record<string, unknown>;
            const jtLower = String(row.job_type || "").trim().toLowerCase();
            const autoS0 = String(resultEarly.auto_share_summary || "").trim();
            const autoN0 = String(resultEarly.auto_share_show_notes || "").trim();
            const hasAutoBoth0 = Boolean(autoS0 && autoN0);
            if (
              !deferredShareAiOnceRef.current &&
              !hasAutoBoth0 &&
              jtLower !== "script_draft" &&
              jobResultHasPlayableAudio(resultEarly)
            ) {
              deferredShareAiOnceRef.current = true;
              void (async () => {
                try {
                  if (canceledRef.current) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const out = await fetchJobShareAiCopy(jobId, { persist: true });
                  if (canceledRef.current || !out.success) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const sum = String(out.summary ?? "").trim();
                  const notes = String(out.show_notes ?? "").trim();
                  if (!sum && !notes) {
                    deferredShareAiOnceRef.current = false;
                    return;
                  }
                  const snap = initialSnapshotRef.current;
                  if (snap) {
                    initialSnapshotRef.current = {
                      episodeTitle: snap.episodeTitle,
                      summary: truncateSummaryToAutoMax(sum || snap.summary),
                      showNotes: notes || snap.showNotes
                    };
                  }
                  if (sum) setSummary(truncateSummaryToAutoMax(sum));
                  if (notes) setShowNotes(notes);
                  try {
                    const fresh = await getJob(jobId);
                    if (!canceledRef.current && fresh) setOwnerJobRecord(fresh);
                  } catch {
                    /* ignore */
                  }
                } catch {
                  deferredShareAiOnceRef.current = false;
                }
              })();
            }
            break;
          }
          if (st === "failed" || st === "cancelled") break;
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      if (!canceledRef.current) {
        setJobLiveProgressMsg("");
      }
    })();

    return () => {
      canceledRef.current = true;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    };
  }, [jobId, layout, shareJobHydrated, formReady, mergeRunningJobSnapshot]);

  const scriptDraft = jobType === "script_draft";

  const viewerTemplateReadonly = useMemo(() => {
    const row = ownerJobRecord;
    if (!row) return false;
    if (row.viewer_template_readonly === true) return true;
    if (!row.is_podcast_template) return false;
    const owner = String(row.created_by || "").trim().toLowerCase();
    const me = userAccountRef(user).trim().toLowerCase();
    if (!me) return false;
    if (!owner) return true;
    return me !== owner;
  }, [ownerJobRecord, user]);

  const onWorkHubDownloadBundle = useCallback(async () => {
    const id = jobId.trim();
    if (!id) return;
    if (viewerTemplateReadonly) {
      window.alert("模板作品仅创建者可下载。");
      return;
    }
    setWorkHubDownloadBusy(true);
    const title = episodeTitle.trim() || jobTitle.trim() || id;
    try {
      if (scriptDraft) {
        await downloadJobManuscriptTxt({ jobId: id, title });
      } else {
        await downloadJobBundleZip({
          jobId: id,
          title,
          showNotesMarkdown: showNotes
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isWorkDownloadRechargeGateError(msg)) {
        setWorkDownloadRechargeModalOpen(true);
      } else {
        window.alert(msg);
      }
    } finally {
      setWorkHubDownloadBusy(false);
    }
  }, [jobId, episodeTitle, jobTitle, scriptDraft, showNotes, viewerTemplateReadonly]);
  const audioBlocked = scriptDraft || !hasAudio;
  /** 未 hydration 前 blocked 为 false，避免误显分享区；仅 hydration 后才允许复制链接与发布表单。 */
  const showShareAndPublish = shareJobHydrated && !audioBlocked;

  const jobCoverUrl = useMemo(() => {
    const fromOwner = ownerJobRecord
      ? jobResultCoverUrl(ownerJobRecord.result as Record<string, unknown>)
      : "";
    return fromOwner.trim() || listenCoverUrl;
  }, [listenCoverUrl, ownerJobRecord]);

  const audioDurationHintSec = useMemo(() => {
    if (scriptDraft) return null;
    if (ownerJobRecord) {
      const r = ownerJobRecord.result as Record<string, unknown>;
      const raw = r.audio_duration_sec;
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
      if (typeof raw === "string" && String(raw).trim()) {
        const n = Number.parseFloat(String(raw));
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    }
    if (listenDurationSec != null && Number.isFinite(listenDurationSec) && listenDurationSec > 0) {
      return listenDurationSec;
    }
    return null;
  }, [scriptDraft, ownerJobRecord, listenDurationSec]);

  useEffect(() => {
    if (layout !== "work_hub") return;
    setShareConfigModalOpen(initialHubTab === "publish");
  }, [layout, jobId, initialHubTab]);

  useEffect(() => {
    if (layout !== "work_hub") return;
    setNotesTab("preview");
  }, [layout, jobId]);

  useEffect(() => {
    if (!viewerTemplateReadonly) return;
    setNotesTab("preview");
  }, [viewerTemplateReadonly]);

  useEffect(() => {
    if (layout !== "work_hub") return;
    setDetailTab(viewerTemplateReadonly ? "shownotes" : "edit");
  }, [layout, jobId, viewerTemplateReadonly]);

  useEffect(() => {
    if (!morePlatformsOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      const wrap = morePlatformsRef.current;
      const panel = moreMenuPanelRef.current;
      if (wrap?.contains(t) || panel?.contains(t)) return;
      setMorePlatformsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [morePlatformsOpen]);

  const workHubPublishModalVisible = layout === "work_hub" && shareConfigModalOpen;

  useEffect(() => {
    if (!(layout === "work_hub" && shareConfigModalOpen)) {
      setMorePlatformsOpen(false);
      setMoreMenuFixedStyle(null);
    }
  }, [layout, shareConfigModalOpen]);

  const backNavTarget = sanitizeWorkDetailReturnTo(
    returnToProp,
    ownerJobRecord ? "/works" : "/"
  );

  const worksNavAuthorDisplay = useMemo(() => {
    const u = user as { display_name?: string; username?: string; phone?: string } | null | undefined;
    if (!u || u.phone === "local") return "我";
    const dn = typeof u.display_name === "string" ? u.display_name.trim() : "";
    if (dn) return dn.length > 16 ? `${dn.slice(0, 16)}…` : dn;
    const un = typeof u.username === "string" ? u.username.trim() : "";
    if (un) return un.length > 16 ? `${un.slice(0, 16)}…` : un;
    const ph = typeof u.phone === "string" ? u.phone.replace(/\s/g, "") : "";
    if (ph.length >= 4) return `尾号 ${ph.slice(-4)}`;
    return "我";
  }, [user]);

  const navMetaPipe = useMemo(() => {
    if (!ownerJobRecord) return "";
    return formatUnifiedWorksNavMetaLineFromJobRecord(ownerJobRecord, worksNavAuthorDisplay, {
      manuscriptBody
    });
  }, [ownerJobRecord, worksNavAuthorDisplay, manuscriptBody]);

  const canEditWorkScript = useMemo(() => {
    const jt = String(ownerJobRecord?.job_type || "").trim().toLowerCase();
    const st = ownerJobRecord?.status;
    return Boolean(
      ownerJobRecord &&
        st === "succeeded" &&
        ["podcast", "podcast_generate", "script_draft"].includes(jt) &&
        !viewerTemplateReadonly
    );
  }, [ownerJobRecord, viewerTemplateReadonly]);

  const jobGenerating = Boolean(
    ownerJobRecord && (ownerJobRecord.status === "queued" || ownerJobRecord.status === "running")
  );

  useEffect(() => {
    const st = ownerJobRecord?.status;
    if (st !== "queued" && st !== "running") return;
    const id = window.setInterval(() => setJobGenTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [ownerJobRecord?.id, ownerJobRecord?.status]);

  const jobGenEtaDisplay = useMemo(() => {
    if (!ownerJobRecord) return null;
    const st = ownerJobRecord.status;
    if (st !== "queued" && st !== "running") return null;
    void jobGenTick;
    const estimateSec = defaultJobGenEstimateSec(ownerJobRecord.job_type);
    const startedMs = ownerJobRecord.started_at ? Date.parse(ownerJobRecord.started_at) : NaN;
    const createdMs = Date.parse(ownerJobRecord.created_at);
    const t0 = Number.isFinite(startedMs)
      ? startedMs
      : Number.isFinite(createdMs)
        ? createdMs
        : Date.now();
    const elapsedSec = Math.max(0, (Date.now() - t0) / 1000);
    const queued = st === "queued";
    const pct = queued
      ? Math.min(12, (elapsedSec / 120) * 12)
      : Math.min(94, (elapsedSec / estimateSec) * 100);
    const remainingSec = Math.max(0, estimateSec - elapsedSec);
    const mm = Math.floor(elapsedSec / 60);
    const ss = Math.floor(elapsedSec % 60);
    const elapsedLabel = `${mm}:${String(ss).padStart(2, "0")}`;
    const caption = queued
      ? `排队中 · 已等待 ${elapsedLabel} · 预估成片约 ${formatEtaRoughCn(estimateSec)}`
      : `已进行 ${elapsedLabel} · 预估总时长约 ${formatEtaRoughCn(estimateSec)} · 剩余约 ${formatEtaRoughCn(remainingSec)}`;
    return { pct, caption };
  }, [ownerJobRecord, jobGenTick]);

  const jobFailedMessage =
    ownerJobRecord?.status === "failed" ? String(ownerJobRecord.error_message || "").trim() : "";

  const jobGenBannerLine =
    jobGenerating && jobGenEtaDisplay
      ? jobLiveProgressMsg.trim()
        ? `${jobGenEtaDisplay.caption} · ${jobLiveProgressMsg.trim()}`
        : jobGenEtaDisplay.caption
      : jobLiveProgressMsg.trim() ||
        (jobGenerating ? (ownerJobRecord?.status === "queued" ? "排队中…" : "正在生成…") : "");

  const jobLivePctMerged = jobGenerating && jobGenEtaDisplay ? jobGenEtaDisplay.pct : null;

  const showManuscriptTools = useMemo(
    () => layout === "work_hub" && Boolean(ownerJobRecord) && shareJobHydrated && !loadErr,
    [layout, ownerJobRecord, shareJobHydrated, loadErr]
  );

  const regenerateVoiceSupported = useMemo(() => {
    if (!ownerJobRecord || scriptDraft || !hasAudio || viewerTemplateReadonly) return false;
    const jt = String(ownerJobRecord.job_type || "").trim().toLowerCase();
    return jt === "podcast" || jt === "podcast_generate";
  }, [ownerJobRecord, scriptDraft, hasAudio, viewerTemplateReadonly]);

  const startAudioResynth = useCallback(async () => {
    const row = ownerJobRecord;
    if (!row || viewerTemplateReadonly || regenerateVoiceBusy || audioRegenActive) return;
    const script = manuscriptBody.trim();
    if (!script) {
      window.alert("请先填写或加载口播稿正文。");
      return;
    }
    const jt = String(row.job_type || "").trim().toLowerCase();
    if (jt !== "podcast" && jt !== "podcast_generate") return;

    const oldId = String(row.id || jobId).trim();
    const projectName = String(row.project_name || "").trim() || "web-podcast-native";
    const createdBy = userAccountRef(user) || String(phone || "").trim() || undefined;

    /**
     * 深拷贝任务创建时落库的 payload：voice_id / voice_id_1/2、output_mode、intro/outro、
     * tts_sentence_chunks、auto_degrade_tts、BGM 槽位等均在 worker 的 run_extended_tts 前原样参与合成。
     * 服务端对 resynth 路径仍是对整稿 script 跑完整 TTS 管线并输出成片，不做「仅改动片段再拼回旧音频」。
     */
    let basePayload: Record<string, unknown>;
    try {
      basePayload = JSON.parse(JSON.stringify(row.payload || {})) as Record<string, unknown>;
    } catch {
      basePayload = { ...(row.payload || {}) };
    }
    delete basePayload.resynth_audio_only;
    delete basePayload.resynth_script_text;
    basePayload.resynth_audio_only = true;
    basePayload.resynth_script_text = script;
    basePayload.generate_cover = false;

    audioRegenAbortRef.current = false;
    setRegenerateVoiceBusy(true);
    setAudioRegenActive(true);
    setAudioRegenProgress(2);
    setAudioRegenMessage("正在校验计费与队列…");

    try {
      const prev = await previewMediaJob({
        project_name: projectName,
        job_type: jt,
        queue_name: "media",
        payload: basePayload,
        ...(createdBy ? { created_by: createdBy } : {})
      });
      if (prev.allowed === false) {
        throw new Error((prev.detail || "").trim() || "当前无法创建语音合成任务（余额或套餐）。");
      }
      if (prev.summary) {
        setAudioRegenMessage(String(prev.summary));
      }

      setAudioRegenProgress(5);
      setAudioRegenMessage("已创建任务，正在生成音频…");

      const created = await createJob({
        project_name: projectName,
        job_type: jt,
        queue_name: "media",
        payload: basePayload,
        ...(createdBy ? { created_by: createdBy } : {})
      });
      const newId = String(created.id || "").trim();
      if (!newId) throw new Error("创建任务成功但未返回编号");

      const terminalFail = new Set(["failed", "cancelled"]);
      let lastProgress = 5;
      let succeededRow: JobRecord | null = null;
      for (let i = 0; i < 3600; i += 1) {
        if (audioRegenAbortRef.current) {
          setAudioRegenMessage("已离开页面，停止轮询（任务可能仍在后台运行）。");
          return;
        }
        const j = await getJob(newId);
        const st = String(j.status || "").trim().toLowerCase();
        const p = typeof j.progress === "number" && Number.isFinite(j.progress) ? j.progress : lastProgress;
        lastProgress = p;
        setAudioRegenProgress(Math.min(99, Math.max(5, p)));
        if (st === "succeeded") {
          setAudioRegenProgress(100);
          setAudioRegenMessage("即将完成…");
          succeededRow = j;
          break;
        }
        if (st === "running" || st === "queued") {
          setAudioRegenMessage(st === "queued" ? "排队中…" : "正在合成音频…");
        } else if (terminalFail.has(st)) {
          const err = String(j.error_message || "").trim() || `任务状态：${st}`;
          throw new Error(err);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (!succeededRow) {
        throw new Error("合成等待超时，请到「我的作品」查看新任务是否仍在进行。");
      }

      const coverRes = await fetch(`/api/jobs/${encodeURIComponent(oldId)}/cover`, {
        method: "GET",
        credentials: "same-origin",
        headers: { ...getBearerAuthHeadersSync() }
      });
      if (coverRes.ok) {
        const blob = await coverRes.blob();
        if (blob.size > 0) {
          const { base64: image_base64 } = await blobToDataUrlBase64(blob);
          const content_type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
          const up = await fetch(`/api/jobs/${encodeURIComponent(newId)}/cover`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
            body: JSON.stringify({ image_base64, content_type })
          });
          if (!up.ok) {
            void (await up.text().catch(() => ""));
          }
        }
      }

      try {
        const del = await fetch(`/api/jobs/${encodeURIComponent(oldId)}/delete`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
          body: "{}"
        });
        if (!del.ok) {
          void (await del.text().catch(() => ""));
        }
      } catch {
        /* ignore */
      }

      router.replace(`/works/${encodeURIComponent(newId)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAudioRegenMessage(msg || "重新合成失败");
      window.alert(msg || "重新合成失败");
    } finally {
      setRegenerateVoiceBusy(false);
      setAudioRegenActive(false);
      setAudioRegenProgress(0);
    }
  }, [
    ownerJobRecord,
    regenerateVoiceBusy,
    audioRegenActive,
    manuscriptBody,
    jobId,
    user,
    phone,
    router,
    viewerTemplateReadonly
  ]);

  useEffect(() => {
    audioRegenAbortRef.current = false;
    return () => {
      audioRegenAbortRef.current = true;
    };
  }, [jobId]);

  const onManuscriptSaved = useCallback(
    async (next: string) => {
      setManuscriptBody(next);
      try {
        const fresh = await getJob(jobId);
        if (fresh) setOwnerJobRecord(fresh);
      } catch {
        /* ignore */
      }
    },
    [jobId]
  );

  useEffect(() => {
    let canceled = false;
    if (!shareJobHydrated || audioBlocked || !ownerJobRecord) {
      setRssGate("idle");
      setRssGateDetail("");
      return () => {
        canceled = true;
      };
    }
    void (async () => {
      setRssGate("loading");
      setRssGateDetail("");
      try {
        const r = await fetchRssPublishEligibility(jobId);
        if (canceled) return;
        if (r.success === false) {
          setRssGate("err");
          setRssGateDetail((r.detail || "").trim() || "无法校验 RSS 发布条件");
          return;
        }
        if (r.eligible) {
          setRssGate("ok");
          setRssGateDetail("");
        } else {
          setRssGate("blocked");
          setRssGateDetail((r.detail || "").trim() || "当前账户或作品不符合 RSS 发布条件。");
        }
      } catch (e) {
        if (!canceled) {
          setRssGate("err");
          setRssGateDetail(String(e instanceof Error ? e.message : e));
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [jobId, shareJobHydrated, audioBlocked, ownerJobRecord]);

  useEffect(() => {
    let canceled = false;
    if (rssGate !== "ok" || !ownerJobRecord) {
      setChannels([]);
      setChannelId("");
      return () => {
        canceled = true;
      };
    }
    void (async () => {
      setChannelsLoading(true);
      setFormErr("");
      try {
        const rows = await listRssChannels();
        if (canceled) return;
        setChannels(rows);
        if (rows.length > 0) {
          setChannelId((prev) => {
            if (prev && rows.some((c) => String(c.id) === prev)) return prev;
            let last = "";
            try {
              last = String(readLocalStorageScoped(RSS_LAST_CHANNEL_STORAGE_KEY) || "").trim();
            } catch {
              last = "";
            }
            if (last && rows.some((c) => String(c.id) === last)) return last;
            return String(rows[0]!.id || "");
          });
        }
      } catch (e) {
        if (!canceled) setFormErr(String(e instanceof Error ? e.message : e));
      } finally {
        if (!canceled) setChannelsLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [rssGate, ownerJobRecord]);

  useEffect(() => {
    if (!channelId.trim()) return;
    if (!channels.some((c) => String(c.id) === channelId)) return;
    try {
      writeLocalStorageScoped(RSS_LAST_CHANNEL_STORAGE_KEY, channelId);
    } catch {
      /* ignore */
    }
  }, [channelId, channels]);

  useEffect(() => {
    if (!rssSetupModalOpen && !aiShownotesModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRssSetupModalOpen(false);
        setAiShownotesModalOpen(false);
        setAiShownotesErr("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rssSetupModalOpen, aiShownotesModalOpen]);

  useEffect(() => {
    if (!aiShownotesModalOpen) return;
    const t = window.setTimeout(() => aiShownotesPromptRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [aiShownotesModalOpen]);

  useEffect(() => {
    if (!aiShownotesModalOpen && notesTab === "ai") {
      setNotesTab("preview");
    }
  }, [aiShownotesModalOpen, notesTab]);

  useEffect(() => {
    if (!scheduleModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setScheduleModalOpen(false);
        setScheduleModalErr("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduleModalOpen]);

  function openScheduleModal() {
    setScheduleModalDraft(publishAt.trim() ? publishAt : defaultScheduleDatetimeLocal());
    setScheduleModalErr("");
    setScheduleModalOpen(true);
  }

  function confirmScheduleModal() {
    const v = scheduleModalDraft.trim();
    if (!v) {
      setScheduleModalErr("请选择发布时间。");
      return;
    }
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) {
      setScheduleModalErr("时间无效，请重新选择。");
      return;
    }
    setPublishAt(v);
    setSchedulePublish(true);
    setScheduleModalOpen(false);
    setScheduleModalErr("");
  }

  function cancelScheduleModal() {
    setScheduleModalOpen(false);
    setScheduleModalErr("");
  }

  const seekFromNotes = useCallback(
    (sec: number) => {
      if (!hasAudio) {
        window.alert("无法跳转：无音频。");
        return;
      }
      const title = episodeTitle.trim() || jobTitle || jobId;
      const direct = sharePublicAudioUrl.trim();
      const meta: WorkAudioToggleMeta = {
        displayTitle: title,
        seekSeconds: sec,
        ...(direct ? { directAudioUrl: direct } : {})
      };
      if (workAudio.activeJobId === jobId && workAudio.loadingJobId !== jobId) {
        workAudio.seekForActiveJob(sec);
        void workAudio.resume();
        return;
      }
      void workAudio.togglePlay(jobId, meta);
    },
    [hasAudio, episodeTitle, jobTitle, jobId, workAudio, sharePublicAudioUrl]
  );

  function restoreDraft() {
    const d = loadShareFormDraft(jobId);
    if (!d) return;
    setEpisodeTitle(d.episodeTitle);
    setSummary(truncateSummaryToAutoMax(d.summary));
    setShowNotes(d.showNotes);
  }

  function discardDraft() {
    clearShareFormDraft(jobId);
    const snap = initialSnapshotRef.current;
    if (snap) {
      setEpisodeTitle(snap.episodeTitle);
      setSummary(truncateSummaryToAutoMax(snap.summary));
      setShowNotes(snap.showNotes);
    }
  }

  async function applyShareAiCopyFromProvider(opts?: { persist?: boolean }) {
    if (!jobId.trim()) return;
    if (viewerTemplateReadonly) {
      setFormErr("模板作品仅创建者可使用 AI 编辑。");
      return;
    }
    setShareAiBusy(true);
    setFormErr("");
    setFormOk("");
    /** 默认落库：刷新页后仍从 jobs.result 的 auto_share_* 恢复，避免被旧稿或本地草稿覆盖 */
    const persist = opts?.persist !== false;
    try {
      const out = await fetchJobShareAiCopy(jobId, { persist });
      if (!out.success) {
        throw new Error("服务端未返回成功状态");
      }
      const sum = String(out.summary ?? "").trim();
      const notes = String(out.show_notes ?? "").trim();
      if (!sum && !notes) {
        throw new Error("返回内容为空");
      }
      let nextSummary = summary;
      let nextNotes = showNotes;
      if (sum) {
        const clipped = truncateSummaryToAutoMax(sum);
        setSummary(clipped);
        nextSummary = clipped;
      }
      if (notes) {
        setShowNotes(notes);
        nextNotes = notes;
      }
      initialSnapshotRef.current = {
        episodeTitle,
        summary: nextSummary,
        showNotes: nextNotes
      };
      if (persist) {
        try {
          const fresh = await getJob(jobId);
          if (fresh) setOwnerJobRecord(fresh);
        } catch {
          /* ignore */
        }
        clearShareFormDraft(jobId);
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setFormErr(msg || "AI 生成失败");
    } finally {
      setShareAiBusy(false);
    }
  }

  async function applyAiShownotesRefine() {
    if (!jobId.trim()) return;
    if (viewerTemplateReadonly) {
      setAiShownotesErr("模板作品仅创建者可使用 AI 优化。");
      return;
    }
    const promptRaw = aiShownotesPromptDraft.trim();
    const userPrompt = promptRaw || AI_SHOWNOTES_PROMPT_PLACEHOLDER;
    setShareAiBusy(true);
    setAiShownotesErr("");
    setFormErr("");
    setFormOk("");
    const persist = true;
    try {
      const out = await fetchJobShareAiCopy(jobId, {
        persist,
        showNotesOnly: true,
        userPrompt,
        baselineShowNotes: showNotes
      });
      if (!out.success) {
        throw new Error("服务端未返回成功状态");
      }
      const notes = String(out.show_notes ?? "").trim();
      if (!notes) {
        throw new Error("返回内容为空");
      }
      setShowNotes(notes);
      initialSnapshotRef.current = {
        episodeTitle,
        summary,
        showNotes: notes
      };
      if (persist) {
        try {
          const fresh = await getJob(jobId);
          if (fresh) setOwnerJobRecord(fresh);
        } catch {
          /* ignore */
        }
        clearShareFormDraft(jobId);
      }
      setAiShownotesModalOpen(false);
      setNotesTab("preview");
      setFormOk("Shownotes 已更新。");
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setAiShownotesErr(msg || "AI 生成失败");
    } finally {
      setShareAiBusy(false);
    }
  }

  async function saveShowNotesToServer() {
    if (!jobId.trim() || !ownerJobRecord) return;
    if (viewerTemplateReadonly) return;
    setShowNotesSaveBusy(true);
    setFormErr("");
    setFormOk("");
    try {
      await fetchPersistShareShowNotes(jobId, showNotes);
      initialSnapshotRef.current = {
        episodeTitle,
        summary,
        showNotes
      };
      try {
        const fresh = await getJob(jobId);
        if (fresh) setOwnerJobRecord(fresh);
      } catch {
        /* ignore */
      }
      clearShareFormDraft(jobId);
      setFormOk("Shownotes 已保存。");
    } catch (e) {
      setFormErr(String(e instanceof Error ? e.message : e) || "保存失败");
    } finally {
      setShowNotesSaveBusy(false);
    }
  }

  async function submit() {
    setFormErr("");
    setFormOk("");
    if (shareAiBusy) {
      setFormErr("AI 生成中，请稍候再发布。");
      return;
    }
    if (viewerTemplateReadonly) {
      setFormErr("模板作品仅创建者可发布。");
      return;
    }
    if (publishPlatform !== "xiaoyuzhou") {
      setFormErr("请先选择小宇宙。");
      return;
    }
    if (rssGate !== "ok") {
      setFormErr(
        rssGateDetail.trim() || "当前不符合 RSS 发布条件。"
      );
      return;
    }
    if (!channelId) {
      setFormErr("请选择 RSS 频道。");
      return;
    }
    if (!episodeTitle.trim()) {
      setFormErr("请填写标题。");
      return;
    }
    if (!hasAudio) {
      setFormErr("没有可发布的音频。");
      return;
    }
    if (schedulePublish) {
      if (!publishAt.trim()) {
        setFormErr("请设置定时发布时间。");
        return;
      }
      const ts = new Date(publishAt).getTime();
      if (Number.isNaN(ts)) {
        setFormErr("发布时间无效，请重新设置。");
        return;
      }
    }
    const h = computeSharePublishHints(episodeTitle, summary, showNotes);
    if (h.summaryEmpty) {
      if (!window.confirm("简介为空，仍发布？")) {
        return;
      }
    }
    setBusy(true);
    try {
      await publishWorkToRss({
        channel_id: channelId,
        job_id: jobId,
        title: episodeTitle.trim(),
        summary: truncateSummaryToAutoMax(summary.trim()),
        show_notes: showNotes.trim(),
        explicit: false,
        publish_at: schedulePublish && publishAt.trim() ? new Date(publishAt).toISOString() : undefined,
        force_republish: true
      });
      clearShareFormDraft(jobId);
      initialSnapshotRef.current = {
        episodeTitle,
        summary: truncateSummaryToAutoMax(summary.trim()),
        showNotes: showNotes.trim()
      };
      setSharePublishDirty(false);
      setFormOk(schedulePublish ? "已提交定时发布。" : "已发布。");
      try {
        const rows = await listRssPublicationsByJobIds([jobId]);
        const list = rows[jobId] || [];
        setPublishedHint(list.length > 0 ? `已发布：${list.map((p) => p.channel_title).join("、")}` : "");
      } catch {
        /* ignore */
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("already_published_same_channel")) {
        setFormErr("该频道已发布过，服务端未接受覆盖，请稍后重试或更换频道。");
      } else {
        setFormErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const mainMax = layout === "work_hub" ? "max-w-4xl" : "max-w-2xl";
  const otherPublishPlatforms = PUBLISH_PLATFORMS.filter((p) => !PINNED_PUBLISH_PLATFORM_SET.has(p.id));

  useLayoutEffect(() => {
    if (!morePlatformsOpen) {
      setMoreMenuFixedStyle(null);
      return;
    }
    const update = () => {
      const wrap = morePlatformsRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const itemCount = otherPublishPlatforms.length;
      const estH = Math.min(360, Math.max(96, itemCount * 40 + 8));
      const gap = 6;
      const mw = 11 * 16;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const openBelow = spaceBelow >= estH || r.bottom <= window.innerHeight * 0.42;
      const top = openBelow ? r.bottom + gap : Math.max(8, r.top - estH - gap);
      const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
      setMoreMenuFixedStyle({ top, left, width: mw });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [morePlatformsOpen, otherPublishPlatforms.length]);

  const showWorkHubShareEntry =
    layout === "work_hub" &&
    shareJobHydrated &&
    !loadErr &&
    formReady &&
    Boolean(ownerJobRecord) &&
    !scriptDraft;

  return (
    <main className={`mx-auto min-h-0 w-full ${mainMax} px-3 pb-12 pt-5 sm:px-4`}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-brand">
            <button
              type="button"
              onClick={() => router.push(backNavTarget)}
              className="rounded px-0.5 py-0 font-medium hover:underline"
              aria-label={ownerJobRecord ? "返回我的作品" : "返回首页"}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => router.push(backNavTarget)}
              className="rounded px-0.5 py-0 font-medium hover:underline"
            >
              {ownerJobRecord ? "返回我的作品" : "返回首页"}
            </button>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {layout === "work_hub" ? "作品详情" : "发给朋友听"}
          </h1>
        </div>
        {showWorkHubShareEntry ? (
          <div className="mt-1 flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={viewerTemplateReadonly || workHubDownloadBusy}
              onClick={() => void onWorkHubDownloadBundle()}
              className="rounded-xl border border-line bg-fill/40 p-2.5 text-ink hover:bg-fill disabled:opacity-40"
              aria-label={scriptDraft ? "下载文稿" : "下载作品包"}
              title={
                viewerTemplateReadonly
                  ? "模板作品仅创建者可下载"
                  : scriptDraft
                    ? "下载文稿（TXT）"
                    : "下载文稿、封面、Shownotes 与音频（ZIP）"
              }
            >
              <IconDownloadBundle className={`h-5 w-5 ${workHubDownloadBusy ? "opacity-60" : ""}`} />
            </button>
            <button
              type="button"
              disabled={viewerTemplateReadonly}
              onClick={() => setShareConfigModalOpen(true)}
              className="rounded-xl border border-line bg-fill/40 p-2.5 text-ink hover:bg-fill disabled:opacity-40"
              aria-label="分享与发布"
              title={viewerTemplateReadonly ? "模板作品仅创建者可分享发布" : "分享与发布"}
            >
              <IconShareExport className="h-5 w-5" />
            </button>
          </div>
        ) : null}
      </div>

      {loadErr ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">{loadErr}</p>
      ) : null}

      {!loadErr && !shareJobHydrated ? (
        <p className="mb-4 rounded-lg border border-line bg-fill/60 px-3 py-2 text-sm text-muted" role="status">
          加载中…
        </p>
      ) : null}

      {sharePublishDirty && layout !== "standalone" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/35 bg-warning-soft/80 px-3 py-2 text-xs text-warning-ink">
          <span>本地草稿未保存</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-brand px-2.5 py-1 text-brand-foreground hover:opacity-95" onClick={restoreDraft}>
              恢复
            </button>
            <button type="button" className="rounded-md border border-line bg-surface px-2.5 py-1 hover:bg-fill" onClick={discardDraft}>
              丢弃
            </button>
          </div>
        </div>
      ) : null}

      {layout === "standalone" && shareJobHydrated && !loadErr && formReady ? (
        <div className="mb-8 space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-6">
            <div className="relative mx-auto aspect-square w-full max-w-[min(100%,20rem)] shrink-0 overflow-hidden rounded-2xl border border-line bg-fill/30 shadow-soft lg:mx-0 lg:aspect-auto lg:h-[280px] lg:w-[280px] lg:max-w-[280px]">
              {workCoverImageSrc(jobCoverUrl, undefined, jobId) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={workCoverImageSrc(jobCoverUrl, undefined, jobId)}
                  alt=""
                  className="aspect-square w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="eager"
                />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-brand/[0.12] via-fill to-cta/[0.1] px-4 text-center lg:aspect-auto lg:h-[280px] lg:min-h-[280px]">
                  <span className="text-3xl" aria-hidden>
                    🎙️
                  </span>
                  <span className="text-xs text-muted">暂无封面</span>
                </div>
              )}
              {!audioBlocked && hasAudio ? (
                <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 sm:p-3">
                  <button
                    type="button"
                    disabled={workAudio.loadingJobId === jobId}
                    onClick={(e) => {
                      e.stopPropagation();
                      void workAudio.togglePlay(jobId, {
                        displayTitle: episodeTitle.trim() || jobTitle || jobId,
                        directAudioUrl: sharePublicAudioUrl.trim() || undefined
                      });
                    }}
                    className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink/80 text-brand-foreground shadow-lg backdrop-blur-sm transition hover:bg-ink/90 disabled:opacity-50"
                    aria-label={
                      workAudio.activeJobId === jobId && workAudio.isPlaying ? "暂停" : "播放"
                    }
                    title={
                      workAudio.activeJobId === jobId && workAudio.isPlaying
                        ? "暂停"
                        : audioDurationHintSec
                          ? `播放（约 ${formatListenClock(audioDurationHintSec)}）`
                          : "播放"
                    }
                  >
                    {workAudio.loadingJobId === jobId ? (
                      <span className="h-5 w-5 animate-pulse rounded-full bg-brand-foreground/70" aria-hidden />
                    ) : workAudio.activeJobId === jobId && workAudio.isPlaying ? (
                      <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg className="ml-0.5 h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:h-[280px] lg:max-h-[280px] lg:overflow-hidden">
              <h2 className="shrink-0 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {episodeTitle.trim() || "未命名作品"}
              </h2>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain lg:min-h-0">
                {jobGenerating ? null : summary.trim() ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted sm:text-[15px]">
                    {summary.trim()}
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted sm:text-[15px]">
                    暂无简介
                  </p>
                )}
              </div>
            </div>
          </div>
          {!(jobGenerating && !showNotes.trim()) ? (
            <section className="rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4">
              <h3 className="border-b border-line/60 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Shownotes
              </h3>
              <div className="mt-3 max-h-[min(70vh,28rem)] overflow-y-auto rounded-lg border border-line bg-fill/15 p-3">
                <ShowNotesMarkdownPreview
                  markdown={showNotes}
                  onSeekSeconds={seekFromNotes}
                  className="!max-h-none overflow-visible border-0 bg-transparent p-0"
                />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {publishedHint ? (
        <p className="mb-4 rounded-lg border border-success/35 bg-success-soft/70 px-3 py-2 text-xs text-success-ink">{publishedHint}</p>
      ) : null}

      {layout === "work_hub" && shareJobHydrated && !loadErr && !formReady ? (
        <p className="mb-4 rounded-lg border border-line bg-fill/60 px-3 py-2 text-sm text-muted" role="status">
          加载作品信息…
        </p>
      ) : null}

      {layout === "work_hub" && shareJobHydrated && !loadErr && formReady ? (
        <div className="mb-8">
          <WorkHubOverviewPanel
            jobId={jobId}
            displayTitleForDownload={episodeTitle.trim() || jobTitle || jobId}
            episodeTitle={episodeTitle}
            episodeSummary={summary}
            coverUrl={jobCoverUrl}
            navMetaPipe={navMetaPipe}
            hasAudio={hasAudio}
            scriptDraft={scriptDraft}
            audioBlocked={audioBlocked}
            durationSecHint={audioDurationHintSec}
            manuscriptBody={manuscriptBody}
            scriptResolvePending={scriptResolvePending}
            onManuscriptSaved={onManuscriptSaved}
            canEditScript={canEditWorkScript}
            showManuscriptTools={showManuscriptTools}
            regenerateVoiceSupported={regenerateVoiceSupported}
            regenerateVoiceBusy={regenerateVoiceBusy}
            onRegenerateVoice={() => void startAudioResynth()}
            audioRegenActive={audioRegenActive}
            audioRegenProgress={audioRegenProgress}
            audioRegenMessage={audioRegenMessage}
            jobGenerating={jobGenerating}
            jobGenPlaceholder={scriptDraft ? JOB_GEN_SCRIPT_DRAFT_PLACEHOLDER : JOB_GEN_PLACEHOLDER}
            jobLiveLine={jobGenBannerLine}
            jobLiveProgressPct={jobLivePctMerged}
            jobFailedMessage={jobFailedMessage}
            readonlyEmptyHint={jobGenerating ? (scriptDraft ? JOB_GEN_SCRIPT_DRAFT_PLACEHOLDER : JOB_GEN_PLACEHOLDER) : undefined}
            hubViewerReadonly={viewerTemplateReadonly}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            shownotesPanel={
              <WorkHubShownotesSection
                viewerReadonly={viewerTemplateReadonly}
                notesTab={notesTab}
                onNotesTab={setNotesTab}
                showNotes={showNotes}
                onShowNotesChange={setShowNotes}
                onSaveShowNotes={() => void saveShowNotesToServer()}
                onOpenAiModal={() => {
                  setAiShownotesErr("");
                  setAiShownotesPromptDraft("");
                  setAiShownotesModalOpen(true);
                }}
                hints={hints}
                hasAudio={hasAudio}
                onSeekSeconds={seekFromNotes}
                busy={busy}
                shareAiBusy={shareAiBusy}
                showNotesSaveBusy={showNotesSaveBusy}
                scriptResolvePending={scriptResolvePending}
                hasOwner={Boolean(ownerJobRecord)}
                jobGenerating={jobGenerating}
              />
            }
          />
        </div>
      ) : null}

      {layout === "work_hub" && shareJobHydrated && showShareAndPublish && !ownerJobRecord ? (
        <p className="mb-4 text-xs text-muted">
          <Link href="/create" className="text-brand underline">
            登录
          </Link>
          后可编辑简介与 Shownotes、发布 RSS。
        </p>
      ) : null}

      {workHubPublishModalVisible && ownerJobRecord ? (
        typeof document !== "undefined"
          ? createPortal(
              <div
                className="fym-workspace-scrim z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
                role="presentation"
              >
                <button
                  type="button"
                  className="absolute inset-0 cursor-default"
                  aria-label="关闭"
                  onClick={() => setShareConfigModalOpen(false)}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="work-share-publish-modal-title"
                  className="relative z-10 max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
                    <h2 id="work-share-publish-modal-title" className="text-base font-semibold text-ink">
                      分享与发布
                    </h2>
                    {sharePageFullUrl || rssFeedCopyUrl ? (
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {sharePageFullUrl ? (
                          <button
                            type="button"
                            disabled={busy || shareAiBusy}
                            onClick={() => void copySharePageLink()}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-fill/40 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-fill disabled:opacity-40"
                            title={shareLinkCopied ? "已复制" : "复制分享链接"}
                          >
                            {shareLinkCopied ? (
                              <IconShareCheck className="h-3.5 w-3.5 text-success-ink" />
                            ) : (
                              <IconShareClipboard className="h-3.5 w-3.5 text-muted" />
                            )}
                            {shareLinkCopied ? "已复制" : "复制链接"}
                          </button>
                        ) : null}
                        {rssFeedCopyUrl ? (
                          <button
                            type="button"
                            disabled={busy || shareAiBusy}
                            onClick={() => void copyRssFeedUrl()}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-fill/40 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-fill disabled:opacity-40"
                            title={
                              rssLinkCopied
                                ? "已复制"
                                : "复制当前所选 RSS 频道的节目源地址（整档订阅链接，非单集分享页）"
                            }
                          >
                            {rssLinkCopied ? (
                              <IconShareCheck className="h-3.5 w-3.5 text-success-ink" />
                            ) : (
                              <IconShareClipboard className="h-3.5 w-3.5 text-muted" />
                            )}
                            {rssLinkCopied ? "已复制" : "复制RSS地址"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {PINNED_PUBLISH_PLATFORM_IDS.map((pid) => {
                      const label = PUBLISH_PLATFORMS.find((p) => p.id === pid)?.label ?? pid;
                      const active = publishPlatform === pid;
                      const src = PUBLISH_PLATFORM_ICON_URL[pid];
                      const broken = publishPlatformIconBroken[pid];
                      return (
                        <button
                          key={pid}
                          type="button"
                          title={label}
                          disabled={busy || shareAiBusy}
                          onClick={() => {
                            setPublishPlatform(pid);
                            setMorePlatformsOpen(false);
                          }}
                          className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border transition-colors disabled:opacity-40 ${
                            active
                              ? "border-brand bg-brand/15 ring-2 ring-brand/35"
                              : "border-line bg-fill/40 hover:bg-fill"
                          }`}
                        >
                          <span className="sr-only">{label}</span>
                          {src && !broken ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={src}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setPublishPlatformIconBroken((m) => ({ ...m, [pid]: true }))
                              }
                            />
                          ) : (
                            <span aria-hidden className="text-[10px] font-semibold leading-none">
                              {pid === "xiaoyuzhou" ? "宇" : "雅"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <div className="relative" ref={morePlatformsRef}>
                      <button
                        type="button"
                        disabled={busy || shareAiBusy}
                        onClick={() => setMorePlatformsOpen((o) => !o)}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                          !PINNED_PUBLISH_PLATFORM_SET.has(publishPlatform)
                            ? "border-brand bg-brand/15 text-brand"
                            : "border-line bg-fill/40 text-ink hover:bg-fill"
                        }`}
                      >
                        更多
                      </button>
                    </div>
                  </div>

                  <div className="mt-5">
            {!showShareAndPublish ? (
              <div className="rounded-xl border border-warning/35 bg-warning-soft/60 px-4 py-5 text-sm text-warning-ink">
                <p>
                  {scriptDraft
                    ? "纯文稿作品无播客成片，无法通过 RSS 发布音频节目。"
                    : "暂无可发布的播客音频，请确认任务已成功完成后再试。"}
                </p>
              </div>
            ) : publishPlatform !== "xiaoyuzhou" ? (
              <div className="py-12 text-center text-sm text-muted">该平台暂未接入</div>
            ) : rssGate === "idle" || rssGate === "loading" ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted" role="status">
                  {rssGate === "idle" ? "校验发布条件…" : "校验中…"}
                </p>
              </div>
            ) : rssGate === "blocked" || rssGate === "err" ? (
              <div className="rounded-xl border border-warning/35 bg-warning-soft/60 px-4 py-5">
                <p className="text-sm font-medium text-warning-ink">暂无法使用 RSS 发布</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-warning-ink/95">
                  {rssGateDetail.trim() || "请稍后再试或刷新页面。"}
                </p>
                {rssGate === "blocked" ? <BillingShortfallLinks className="mt-4" /> : null}
              </div>
            ) : (
              <div className="space-y-6">
                <section className="space-y-3">
                    <h3 className="text-sm font-medium text-ink">RSS 渠道</h3>
                    {channelsLoading ? (
                      <p className="text-sm text-muted">加载中…</p>
                    ) : channels.length === 0 ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm text-muted">暂无频道</span>
                        <button
                          type="button"
                          className="text-sm font-medium text-brand underline decoration-brand/40 hover:decoration-brand"
                          onClick={() => setRssSetupModalOpen(true)}
                        >
                          去配置
                        </button>
                      </div>
                    ) : (
                      <label className="block text-sm text-muted">
                        频道
                        <select
                          className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                          value={channelId}
                          onChange={(e) => setChannelId(e.target.value)}
                          disabled={busy || shareAiBusy}
                        >
                          <option value="">选择 RSS 频道</option>
                          {channels.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                </section>

                {formErr ? <p className="mt-5 text-sm text-danger-ink">{formErr}</p> : null}
                {formOk ? <p className="mt-5 text-sm text-success-ink">{formOk}</p> : null}

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
                  <button
                    type="button"
                    className="text-sm text-muted hover:text-ink"
                    onClick={() => setShareConfigModalOpen(false)}
                  >
                    关闭
                  </button>
                  <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={schedulePublish}
                        aria-label="定时发布"
                        disabled={busy || shareAiBusy || !showShareAndPublish}
                        onClick={() => {
                          if (schedulePublish) {
                            setSchedulePublish(false);
                          } else {
                            openScheduleModal();
                          }
                        }}
                        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                          schedulePublish ? "bg-brand" : "bg-line"
                        } disabled:opacity-50`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                            schedulePublish ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <span className="text-sm text-muted">定时</span>
                      {schedulePublish && publishAt.trim() ? (
                        <button
                          type="button"
                          className="max-w-[10rem] truncate text-xs text-brand underline decoration-brand/40 hover:decoration-brand disabled:opacity-50"
                          disabled={busy || shareAiBusy || !showShareAndPublish}
                          onClick={() => openScheduleModal()}
                        >
                          {formatSchedulePreview(publishAt)}
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="min-w-[7rem] rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
                      disabled={busy || shareAiBusy || !showShareAndPublish || publishPlatform !== "xiaoyuzhou"}
                      onClick={() => void submit()}
                    >
                      {busy ? (schedulePublish ? "定时发布中…" : "发布中…") : schedulePublish ? "定时发布" : "发布"}
                    </button>
                  </div>
                </div>
              </div>
            )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null
      ) : null}

      {scheduleModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fym-workspace-scrim z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
              role="presentation"
            >
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="关闭"
                onClick={() => cancelScheduleModal()}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="schedule-modal-title"
                className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="schedule-modal-title" className="text-base font-semibold text-ink">
                  定时发布
                </h2>
                <p className="mt-1 text-xs text-muted">RSS 与各客户端同步有延迟。</p>
                <label className="mt-4 block text-sm text-muted">
                  发布时间
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                    value={scheduleModalDraft}
                    onChange={(e) => {
                      setScheduleModalDraft(e.target.value);
                      setScheduleModalErr("");
                    }}
                  />
                </label>
                {scheduleModalErr ? <p className="mt-2 text-sm text-danger-ink">{scheduleModalErr}</p> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-fill/40 px-4 py-2 text-sm text-ink hover:bg-fill"
                    onClick={() => cancelScheduleModal()}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95"
                    onClick={() => confirmScheduleModal()}
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {rssSetupModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fym-workspace-scrim z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
              role="presentation"
            >
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="关闭"
                onClick={() => setRssSetupModalOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="rss-setup-modal-title"
                className="relative z-10 max-h-[min(90vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="rss-setup-modal-title" className="text-base font-semibold text-ink">
                  RSS 频道配置
                </h2>
                <div className="mt-4">
                  <RssChannelEditor
                    channel={null}
                    isNew
                    disabledGlobal={channelsLoading || busy || shareAiBusy}
                    onSaved={(row) => {
                      void (async () => {
                        try {
                          const rows = await listRssChannels();
                          setChannels(rows);
                          const id = String(row.id || "");
                          if (id) setChannelId(id);
                          setRssSetupModalOpen(false);
                        } catch (e) {
                          setFormErr(String(e instanceof Error ? e.message : e));
                        }
                      })();
                    }}
                    onCancelNew={() => setRssSetupModalOpen(false)}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {aiShownotesModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fym-workspace-scrim z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
              role="presentation"
            >
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="关闭"
                onClick={() => {
                  setAiShownotesModalOpen(false);
                  setAiShownotesErr("");
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ai-shownotes-modal-title"
                className="relative z-10 w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="ai-shownotes-modal-title" className="text-base font-semibold text-ink">
                  AI 优化 Shownotes
                </h2>
                <label className="mt-4 block text-sm text-muted">
                  优化示例
                  <textarea
                    ref={aiShownotesPromptRef}
                    className="mt-1 min-h-[7rem] w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-muted/60"
                    value={aiShownotesPromptDraft}
                    placeholder={AI_SHOWNOTES_PROMPT_PLACEHOLDER}
                    onChange={(e) => {
                      setAiShownotesPromptDraft(e.target.value);
                      setAiShownotesErr("");
                    }}
                  />
                </label>
                {aiShownotesErr ? <p className="mt-2 text-sm text-danger-ink">{aiShownotesErr}</p> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-fill/40 px-4 py-2 text-sm text-ink hover:bg-fill"
                    onClick={() => {
                      setAiShownotesModalOpen(false);
                      setAiShownotesErr("");
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
                    disabled={shareAiBusy || scriptResolvePending}
                    onClick={() => void applyAiShownotesRefine()}
                  >
                    {shareAiBusy ? "生成中…" : "生成"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {workHubPublishModalVisible &&
      morePlatformsOpen &&
      moreMenuFixedStyle &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              ref={moreMenuPanelRef}
              role="menu"
              className="z-[1400] max-h-[min(50vh,20rem)] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-card"
              style={{
                position: "fixed",
                top: moreMenuFixedStyle.top,
                left: moreMenuFixedStyle.left,
                width: moreMenuFixedStyle.width,
                minWidth: moreMenuFixedStyle.width
              }}
            >
              {otherPublishPlatforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full px-3 py-2 text-left text-sm text-ink hover:bg-fill/80"
                  onClick={() => {
                    setPublishPlatform(p.id);
                    setMorePlatformsOpen(false);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

      <SmallConfirmModal
        open={workDownloadRechargeModalOpen}
        title="无法下载"
        message={WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE}
        cancelLabel="关闭"
        confirmLabel="充值"
        onCancel={() => setWorkDownloadRechargeModalOpen(false)}
        onConfirm={() => {
          setWorkDownloadRechargeModalOpen(false);
          openSubscriptionWalletTopup();
        }}
      />
    </main>
  );
}
