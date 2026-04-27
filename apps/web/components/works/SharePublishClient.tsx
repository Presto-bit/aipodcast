"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildSharePublishCopyFromScriptAndPayload,
  clearShareFormDraft,
  computeSharePublishHints,
  AUTO_PROGRAM_SUMMARY_MAX,
  defaultSummaryFromJobResult,
  extractEpisodeOverviewFromShowNotes,
  loadShareFormDraft,
  saveShareFormDraft,
  sanitizeShareEpisodeTitle,
  SHARE_TITLE_SOFT_MAX,
  shareFormFieldsDiffer,
  truncateSummaryToAutoMax,
  type ShareFormFields
} from "../../lib/sharePublishDefaults";
import { getBearerAuthHeadersSync } from "../../lib/authHeaders";
import { readSessionStorageScoped } from "../../lib/userScopedStorage";
import {
  createJob,
  fetchJobShareAiCopy,
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
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import {
  DEFAULT_PUBLISH_PLATFORM_ID,
  type PublishPlatformId,
  PUBLISH_PLATFORMS,
  getPublishPlatformMeta
} from "../../lib/publishPlatforms";
import { resolveJobScriptBodyText, SCRIPT_TEXT_LIKELY_FULL_MIN_LEN } from "../../lib/jobScriptText";
import { ShowNotesMarkdownPreview } from "../podcast/ShowNotesMarkdownPreview";
import { buildWorksSharePageUrl } from "../../lib/rssPublicBase";
import { jobResultCoverUrl } from "../../lib/workCoverImage";
import { blobToDataUrlBase64 } from "../../lib/podcastCoverImage";
import { useAuth, userAccountRef } from "../../lib/auth";
import { formatUnifiedWorksNavMetaLineFromJobRecord } from "../../lib/worksNavMetaLine";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";
import { WorkHubOverviewPanel } from "./WorkHubOverviewPanel";
import { WorksShareLinkPreviewCard } from "./WorksShareLinkPreviewCard";

type Props = {
  jobId: string;
  /** `work_hub`：作品详情（概览 + 发布分组）；默认与旧版 `/works/share` 一致 */
  layout?: "standalone" | "work_hub";
  /** 仅 `layout === "work_hub"` 时生效；`publish` 对应 URL `?tab=publish` */
  initialHubTab?: "overview" | "publish";
};

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

export function SharePublishClient({
  jobId,
  layout = "standalone",
  initialHubTab = "overview"
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
  const [notesTab, setNotesTab] = useState<"edit" | "preview">(() =>
    layout === "work_hub" ? "preview" : "edit"
  );
  const [hubTab, setHubTab] = useState<"overview" | "publish">(() =>
    layout === "work_hub" && initialHubTab === "publish" ? "publish" : "overview"
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
  const [chapterOutline, setChapterOutline] = useState<{ title: string; start_ms: number }[] | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  /** 首次拉取任务详情完成前，勿把「无音频」提示当成最终态（避免闪错觉与长文案误报）。 */
  const [shareJobHydrated, setShareJobHydrated] = useState(false);
  const [jobType, setJobType] = useState("");
  /** 任务内 script_text 偏短时，先拉 script 工件（与 AI 优化按钮禁用态同步）。 */
  const [scriptResolvePending, setScriptResolvePending] = useState(false);
  const [scriptBodyHint, setScriptBodyHint] = useState("");

  const [publishedHint, setPublishedHint] = useState("");
  const initialSnapshotRef = useRef<FormSnapshot | null>(null);
  /** 相对服务端基线（initialSnapshot）是否有未落库的本地编辑；不在进入页面时因旧 localStorage 自动为 true */
  const [sharePublishDirty, setSharePublishDirty] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formReady, setFormReady] = useState(false);
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatformId>(DEFAULT_PUBLISH_PLATFORM_ID);
  const [advancedPublishOpen, setAdvancedPublishOpen] = useState(() => layout === "work_hub");
  const [shareOrigin, setShareOrigin] = useState("");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  /** 大模型生成简介 / Show Notes（与发布 busy 分离） */
  const [shareAiBusy, setShareAiBusy] = useState(false);
  /** 当前登录用户且有权访问时拉取到的任务；匿名仅有公开试听数据时为空 */
  const [ownerJobRecord, setOwnerJobRecord] = useState<JobRecord | null>(null);
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

  const shareGenContextRef = useRef<ShareGenContext | null>(null);
  /** 主人进入分享页后至多触发一次「persist 写入 result」的 AI 初稿（Strict Mode 取消时会复位）。 */
  const deferredShareAiOnceRef = useRef(false);

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
      window.alert("复制失败，请长按选框内链接或检查浏览器权限。");
    }
  }, [sharePageFullUrl]);

  const hints = computeSharePublishHints(episodeTitle, summary, showNotes);

  const persistDraft = useCallback(() => {
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
  }, [formReady, jobId, episodeTitle, summary, showNotes]);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => persistDraft(), DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [persistDraft]);

  useEffect(() => {
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
  }, [formReady, episodeTitle, summary, showNotes]);

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

      const rawCh = result.audio_chapters;
      const hasCh =
        Array.isArray(rawCh) &&
        rawCh.length > 0 &&
        rawCh.every((x) => x && typeof x === "object");
      let outline: { title: string; start_ms: number }[] | null = null;
      if (hasCh) {
        outline = (rawCh as Record<string, unknown>[]).map((o) => ({
          title: String(o.title || "章节"),
          start_ms: Number(o.start_ms) || 0
        }));
        setChapterOutline(outline);
      } else {
        setChapterOutline(null);
      }

      setEpisodeTitle(defaultEpisodeTitle);
      setSummary(truncateSummaryToAutoMax(sum));
      setShowNotes("正在生成 Shownotes…");

      initialSnapshotRef.current = {
        episodeTitle: defaultEpisodeTitle,
        summary: truncateSummaryToAutoMax(sum),
        showNotes: "正在生成 Shownotes…"
      };
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
      setScriptBodyHint("");
      setScriptResolvePending(false);
      setOwnerJobRecord(null);

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
            setScriptBodyHint("正在加载正文…");
          }
          let fullScript = shortFrom;
          try {
            fullScript = await resolveJobScriptBodyText(jobId, rowRec, getBearerAuthHeadersSync());
            if (!canceled) {
              if (!fullScript.trim()) {
                setScriptBodyHint("无完整口播稿，简介按任务摘要。");
              } else if (!needsArtifactPath) {
                setScriptBodyHint("简介与正文已关联口播稿。");
              } else if (fullScript.length > shortFrom.length) {
                setScriptBodyHint("已从存储补全文稿。");
              } else if (fullScript.length < SCRIPT_TEXT_LIKELY_FULL_MIN_LEN) {
                setScriptBodyHint("正文较短。");
              } else {
                setScriptBodyHint("简介与正文已关联口播稿。");
              }
            }
          } catch {
            if (!canceled) {
              setScriptBodyHint("正文加载失败，请刷新。");
            }
          } finally {
            if (!canceled) setScriptResolvePending(false);
          }

          if (!canceled) {
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
              initialSnapshotRef.current = { ...derived, episodeTitle: nextEt };
              return nextEt;
            });
            setSummary(derived.summary);
            setShowNotes(derived.showNotes);
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
        setJobType(pub.job_type || "");
        setJobTitle(pub.title);
        setHasAudio(Boolean(pub.audio_url?.trim()));
        const et = pub.title.slice(0, 300);
        setEpisodeTitle(et);
        setSummary(truncateSummaryToAutoMax((pub.preview || "").trim()));
        setShowNotes("");
        const ch = pub.audio_chapters;
        if (Array.isArray(ch) && ch.length > 0) {
          setChapterOutline(
            ch.map((o) => ({
              title: String(o.title || "章节"),
              start_ms: Number(o.start_ms) || 0
            }))
          );
        } else {
          setChapterOutline(null);
        }
        initialSnapshotRef.current = {
          episodeTitle: et,
          summary: truncateSummaryToAutoMax((pub.preview || "").trim()),
          showNotes: ""
        };
        shareGenContextRef.current = null;
        setFormReady(true);
      }

      if (!canceled) setShareJobHydrated(true);
    })();
    return () => {
      canceled = true;
    };
  }, [jobId, applyJobToForm]);

  const scriptDraft = jobType === "script_draft";
  const audioBlocked = scriptDraft || !hasAudio;
  /** 未 hydration 前 blocked 为 false，避免误显分享区；仅 hydration 后才允许复制链接与发布表单。 */
  const showShareAndPublish = shareJobHydrated && !audioBlocked;

  const jobCoverUrl = useMemo(() => {
    if (!ownerJobRecord) return "";
    return jobResultCoverUrl(ownerJobRecord.result as Record<string, unknown>);
  }, [ownerJobRecord]);

  const audioDurationHintSec = useMemo(() => {
    if (!ownerJobRecord) return null;
    const r = ownerJobRecord.result as Record<string, unknown>;
    const raw = r.audio_duration_sec;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
    if (typeof raw === "string" && String(raw).trim()) {
      const n = Number.parseFloat(String(raw));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  }, [ownerJobRecord]);

  useEffect(() => {
    if (layout !== "work_hub") return;
    setHubTab(initialHubTab === "publish" ? "publish" : "overview");
  }, [layout, jobId, initialHubTab]);

  useEffect(() => {
    if (layout !== "work_hub") return;
    setNotesTab("preview");
  }, [layout, jobId]);

  const publishChromeVisible = layout === "standalone" || hubTab === "publish";

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
    return formatUnifiedWorksNavMetaLineFromJobRecord(ownerJobRecord, worksNavAuthorDisplay);
  }, [ownerJobRecord, worksNavAuthorDisplay]);

  /**
   * 作品详情预览简介：优先 Shownotes「## 本期概览」节；否则 result 的 preview 类字段（约 600 字内）；再否则表单 summary。
   */
  const previewIntro = useMemo(() => {
    const fromNotes = extractEpisodeOverviewFromShowNotes(showNotes).trim();
    if (fromNotes) return fromNotes;
    const r = ownerJobRecord?.result as Record<string, unknown> | undefined;
    const fromJob = r ? defaultSummaryFromJobResult(r).trim() : "";
    return fromJob || summary.trim();
  }, [ownerJobRecord, summary, showNotes]);

  const canEditWorkScript = useMemo(() => {
    const jt = String(ownerJobRecord?.job_type || "").trim().toLowerCase();
    return Boolean(ownerJobRecord && ["podcast", "podcast_generate", "script_draft"].includes(jt));
  }, [ownerJobRecord]);

  const showManuscriptTools = useMemo(
    () => layout === "work_hub" && Boolean(ownerJobRecord) && shareJobHydrated && !loadErr,
    [layout, ownerJobRecord, shareJobHydrated, loadErr]
  );

  const regenerateVoiceSupported = useMemo(() => {
    if (!ownerJobRecord || scriptDraft || !hasAudio) return false;
    const jt = String(ownerJobRecord.job_type || "").trim().toLowerCase();
    return jt === "podcast" || jt === "podcast_generate";
  }, [ownerJobRecord, scriptDraft, hasAudio]);

  const startAudioResynth = useCallback(async () => {
    const row = ownerJobRecord;
    if (!row || regenerateVoiceBusy || audioRegenActive) return;
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
    router
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
          setChannelId((id) => id || String(rows[0]!.id || ""));
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
      if (workAudio.activeJobId === jobId && workAudio.loadingJobId !== jobId) {
        workAudio.seekForActiveJob(sec);
        void workAudio.resume();
        return;
      }
      void workAudio.togglePlay(jobId, { displayTitle: title, seekSeconds: sec });
    },
    [hasAudio, episodeTitle, jobTitle, jobId, workAudio]
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

  async function submit() {
    setFormErr("");
    setFormOk("");
    if (shareAiBusy) {
      setFormErr("AI 生成中，请稍候再发布。");
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

  const mainMax = layout === "work_hub" ? "max-w-3xl" : "max-w-2xl";

  return (
    <main className={`mx-auto min-h-0 w-full ${mainMax} px-3 pb-12 pt-5 sm:px-4`}>
      <div className="mb-5 flex flex-col gap-1">
        <Link
          href={ownerJobRecord ? "/works" : "/"}
          className="text-sm text-brand hover:underline"
        >
          {ownerJobRecord ? "← 返回我的作品" : "← 返回首页"}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {layout === "work_hub" ? "作品详情" : "发给朋友听"}
          </h1>
          {jobTitle ? (
            <span className="max-w-[min(100%,14rem)] truncate text-xs text-muted sm:max-w-xs">{jobTitle}</span>
          ) : null}
        </div>
      </div>

      {layout === "work_hub" && shareJobHydrated && !loadErr ? (
        <div className="sticky top-0 z-[60] -mx-3 mb-5 border-b border-line/80 bg-canvas/95 px-1 pb-2 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/80 sm:-mx-4">
          <div className="flex gap-1 rounded-xl border border-line bg-fill/35 p-1">
            <button
              type="button"
              onClick={() => setHubTab("overview")}
              className={`min-h-[2.5rem] flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                hubTab === "overview"
                  ? "bg-surface text-ink shadow-soft"
                  : "text-muted hover:bg-fill/60 hover:text-ink"
              }`}
            >
              预览
            </button>
            <button
              type="button"
              onClick={() => setHubTab("publish")}
              className={`min-h-[2.5rem] flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                hubTab === "publish"
                  ? "bg-surface text-ink shadow-soft"
                  : "text-muted hover:bg-fill/60 hover:text-ink"
              }`}
            >
              发布
            </button>
          </div>
        </div>
      ) : null}

      {loadErr ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">{loadErr}</p>
      ) : null}

      {!loadErr && !shareJobHydrated ? (
        <p className="mb-4 rounded-lg border border-line bg-fill/60 px-3 py-2 text-sm text-muted" role="status">
          加载中…
        </p>
      ) : null}

      {sharePublishDirty ? (
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

      {publishedHint ? (
        <p className="mb-4 rounded-lg border border-success/35 bg-success-soft/70 px-3 py-2 text-xs text-success-ink">{publishedHint}</p>
      ) : null}

      {layout === "work_hub" && hubTab === "overview" && shareJobHydrated && !loadErr && !formReady ? (
        <p className="mb-4 rounded-lg border border-line bg-fill/60 px-3 py-2 text-sm text-muted" role="status">
          加载作品信息…
        </p>
      ) : null}

      {layout === "work_hub" && hubTab === "overview" && shareJobHydrated && !loadErr && formReady ? (
        <div className="mb-8">
          <WorkHubOverviewPanel
            jobId={jobId}
            displayTitleForDownload={episodeTitle.trim() || jobTitle || jobId}
            episodeTitle={episodeTitle}
            previewIntro={previewIntro}
            coverUrl={jobCoverUrl}
            navMetaPipe={navMetaPipe}
            chapterOutline={chapterOutline}
            onSeekSeconds={seekFromNotes}
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
          />
        </div>
      ) : null}

      {publishChromeVisible && showShareAndPublish && sharePageFullUrl ? (
        <div className="mb-5">
          <WorksShareLinkPreviewCard
            coverUrl={jobCoverUrl}
            episodeTitle={episodeTitle}
            summary={summary}
            sharePageFullUrl={sharePageFullUrl}
            onCopy={() => void copySharePageLink()}
            copied={shareLinkCopied}
          />
        </div>
      ) : null}

      {publishChromeVisible && shareJobHydrated && audioBlocked ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          {scriptDraft
            ? "纯文稿作品无播客音频：请在「预览」页查看与编辑正文；RSS 发布需有可播放成片。"
            : "暂无可播放音频，请确认任务已成功完成。"}
        </p>
      ) : null}

      {publishChromeVisible && showShareAndPublish && !ownerJobRecord ? (
        <p className="mb-4 text-xs text-muted">
          <Link href="/create" className="text-brand underline">
            登录
          </Link>
          后可编辑简介与 Shownotes、发布 RSS。
        </p>
      ) : null}

      {publishChromeVisible && showShareAndPublish && ownerJobRecord ? (
        <div className="mb-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-ink hover:bg-fill"
            aria-expanded={advancedPublishOpen}
            onClick={() => setAdvancedPublishOpen((o) => !o)}
          >
            <span className="pr-2">发布到播客平台</span>
            <span className="shrink-0 text-xs text-muted">{advancedPublishOpen ? "收起" : "展开"}</span>
          </button>
        </div>
      ) : null}

      {publishChromeVisible && showShareAndPublish && ownerJobRecord && advancedPublishOpen ? (
        <>
          <div className="mb-5">
            <p className="mb-2 text-xs font-medium text-ink">发布平台</p>
            <div className="flex flex-wrap gap-2">
              {PUBLISH_PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy || shareAiBusy}
                  onClick={() => setPublishPlatform(p.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    publishPlatform === p.id
                      ? "border-brand bg-brand/10 font-medium text-brand"
                      : "border-line bg-surface text-muted hover:border-brand/40 hover:text-ink"
                  } ${!p.available ? "opacity-80" : ""} disabled:opacity-50`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted/90">更多平台开发中。</p>
          </div>

      {publishPlatform !== "xiaoyuzhou" ? (
        <div className="rounded-2xl border border-dashed border-line bg-fill/15 px-4 py-8 text-center shadow-soft sm:px-6">
          <p className="mx-auto max-w-md text-sm text-muted">
            {getPublishPlatformMeta(publishPlatform)?.comingSoonHint ?? "该平台发布配置规划中。"}
          </p>
          <button
            type="button"
            className="mt-4 text-sm font-medium text-brand underline decoration-brand/30 hover:decoration-brand"
            onClick={() => setPublishPlatform("xiaoyuzhou")}
          >
            使用小宇宙发布
          </button>
        </div>
      ) : rssGate === "idle" || rssGate === "loading" ? (
        <div className="rounded-2xl border border-line bg-fill/20 px-4 py-10 text-center shadow-soft sm:px-6">
          <p className="text-sm text-muted" role="status">
            {rssGate === "idle" ? "校验发布条件…" : "校验中…"}
          </p>
        </div>
      ) : rssGate === "blocked" || rssGate === "err" ? (
        <div className="rounded-2xl border border-warning/35 bg-warning-soft/60 px-4 py-5 shadow-soft sm:px-6 sm:py-6">
          <p className="text-sm font-medium text-warning-ink">暂无法使用 RSS 发布</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-warning-ink/95">{rssGateDetail.trim() || "请稍后再试或刷新页面。"}</p>
          {rssGate === "blocked" ? <BillingShortfallLinks className="mt-4" /> : null}
        </div>
      ) : (
      <div className="rounded-2xl border border-line bg-surface px-4 py-5 shadow-soft sm:px-6 sm:py-6">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-ink">RSS 渠道</h2>
            <label className="block text-sm text-muted">
              频道
              <select
                className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={channelsLoading || busy || shareAiBusy}
              >
                <option value="">{channelsLoading ? "加载中…" : "选择 RSS 频道"}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <div className="border-t border-line pt-6">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-ink">标题与简介</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    className="shrink-0 text-xs text-brand underline disabled:opacity-40"
                    disabled={busy || shareAiBusy || scriptResolvePending}
                    onClick={() => void applyShareAiCopyFromProvider()}
                  >
                    {shareAiBusy ? "生成中…" : "AI 优化简介与 Shownotes"}
                  </button>
                </div>
              </div>
              <label className="block text-sm text-muted">
                节目标题
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                  value={episodeTitle}
                  onChange={(e) => setEpisodeTitle(e.target.value)}
                  disabled={busy || shareAiBusy}
                  maxLength={300}
                  placeholder="RSS / 小宇宙单集标题"
                />
                <span className="mt-1 block text-[11px] text-muted/90">默认与作品列表名称一致，可改。</span>
                <span className="mt-0.5 flex justify-end text-[11px] tabular-nums text-muted/80">
                  <span className={hints.titleOverSoft ? "text-warning-ink" : ""}>{episodeTitle.length}</span>
                  <span className="text-muted/60">/{SHARE_TITLE_SOFT_MAX}</span>
                </span>
              </label>
              <div className="text-sm text-muted">
                <span>简介</span>
                {scriptBodyHint ? <p className="mt-1 text-[11px] text-muted/90">{scriptBodyHint}</p> : null}
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value.slice(0, AUTO_PROGRAM_SUMMARY_MAX))}
                  disabled={busy || shareAiBusy}
                  maxLength={AUTO_PROGRAM_SUMMARY_MAX}
                  placeholder="RSS 列表用短摘要"
                />
                <span className="mt-0.5 flex justify-end text-[11px] tabular-nums text-muted/80">
                  <span className={summary.length >= AUTO_PROGRAM_SUMMARY_MAX ? "text-warning-ink" : ""}>
                    {summary.length}
                  </span>
                  <span className="text-muted/60">/{AUTO_PROGRAM_SUMMARY_MAX}</span>
                </span>
                {hints.summaryLooksLikeDialogue ? (
                  <p className="mt-1 text-[11px] text-warning-ink">简介含对白标记，列表展示可能不佳。</p>
                ) : null}
              </div>
            </section>
          </div>

          <div className="border-t border-line pt-6">
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-ink">Shownotes</h2>
                <div className="flex gap-1 rounded-lg border border-line bg-fill/30 p-0.5">
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 text-xs ${notesTab === "edit" ? "bg-surface font-medium text-ink shadow-soft" : "text-muted"}`}
                    onClick={() => setNotesTab("edit")}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 text-xs ${notesTab === "preview" ? "bg-surface font-medium text-ink shadow-soft" : "text-muted"}`}
                    onClick={() => setNotesTab("preview")}
                  >
                    预览
                  </button>
                </div>
              </div>
              {notesTab === "edit" ? (
                <p className="text-[11px] text-muted/90">
                  Markdown；跳转 <code className="rounded bg-fill px-1">[3:20 标题](t:200)</code>
                  {hasAudio ? "，预览可点。" : "。"}
                </p>
              ) : null}
              {notesTab === "edit" ? (
                <textarea
                  className="w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 font-mono text-sm leading-relaxed text-ink"
                  rows={12}
                  value={showNotes}
                  onChange={(e) => setShowNotes(e.target.value)}
                  disabled={busy || shareAiBusy}
                  maxLength={20_000}
                />
              ) : (
                <div className="max-h-[min(70vh,28rem)] overflow-y-auto rounded-lg border border-line bg-fill/20 p-3">
                  <ShowNotesMarkdownPreview
                    markdown={showNotes}
                    onSeekSeconds={seekFromNotes}
                    className="!max-h-none overflow-visible border-0 bg-transparent p-0"
                  />
                </div>
              )}
              {hints.showNotesVeryShort ? (
                <p className="text-[11px] text-warning-ink">Shownotes 偏短。</p>
              ) : null}
            </section>
          </div>
        </div>

        {formErr ? <p className="mt-5 text-sm text-danger-ink">{formErr}</p> : null}
        {formOk ? <p className="mt-5 text-sm text-success-ink">{formOk}</p> : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
          <Link href="/works" className="text-sm text-muted hover:text-ink">
            取消
          </Link>
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
        </>
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

    </main>
  );
}
