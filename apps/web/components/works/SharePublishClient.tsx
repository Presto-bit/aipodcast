"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hexToMp3DataUrl } from "../../lib/audioHex";
import {
  buildSharePublishCopyFromScriptAndPayload,
  clearShareFormDraft,
  computeSharePublishHints,
  AUTO_PROGRAM_SUMMARY_MAX,
  defaultSummaryFromJobResult,
  deriveProgramSummaryOverallMax30,
  formatChapterMarkdownLines,
  loadShareFormDraft,
  promotePlainTimestampLinesInMarkdown,
  saveShareFormDraft,
  sanitizeShareEpisodeTitle,
  SHARE_SUMMARY_IDEAL_MAX,
  SHARE_SUMMARY_WARN_MAX,
  SHARE_TITLE_SOFT_MAX,
  shareFormFieldsDiffer,
  type ShareFormDraft,
  type ShareFormFields
} from "../../lib/sharePublishDefaults";
import { getBearerAuthHeadersSync } from "../../lib/authHeaders";
import { readSessionStorageScoped } from "../../lib/userScopedStorage";
import {
  fetchRssPublishEligibility,
  getJob,
  listRssChannels,
  listRssPublicationsByJobIds,
  publishWorkToRss,
  type RssChannel
} from "../../lib/api";
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

type Props = {
  jobId: string;
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

export function SharePublishClient({ jobId }: Props) {
  const [loadErr, setLoadErr] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [channels, setChannels] = useState<RssChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [showNotes, setShowNotes] = useState("");
  const [notesTab, setNotesTab] = useState<"edit" | "preview">("edit");
  const [publishAt, setPublishAt] = useState("");
  /** 已确认启用定时发布（开关为开且提交时使用 publishAt）。 */
  const [schedulePublish, setSchedulePublish] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalDraft, setScheduleModalDraft] = useState("");
  const [scheduleModalErr, setScheduleModalErr] = useState("");
  const [confirmRepublish, setConfirmRepublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [chapterOutline, setChapterOutline] = useState<{ title: string; start_ms: number }[] | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  /** 首次拉取任务详情完成前，勿把「无音频」提示当成最终态（避免闪错觉与长文案误报）。 */
  const [shareJobHydrated, setShareJobHydrated] = useState(false);
  const [jobType, setJobType] = useState("");
  const [scriptTextForLead, setScriptTextForLead] = useState("");
  /** 任务内 script_text 偏短时，先拉 script 工件再允许「从文稿提炼」，避免用摘要误点。 */
  const [scriptResolvePending, setScriptResolvePending] = useState(false);
  const [scriptBodyHint, setScriptBodyHint] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [publishedHint, setPublishedHint] = useState("");
  const initialSnapshotRef = useRef<FormSnapshot | null>(null);
  const [draftBanner, setDraftBanner] = useState<ShareFormDraft | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formReady, setFormReady] = useState(false);
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatformId>(DEFAULT_PUBLISH_PLATFORM_ID);
  const [advancedPublishOpen, setAdvancedPublishOpen] = useState(false);
  const [shareOrigin, setShareOrigin] = useState("");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  /** RSS 发布：服务端与账户/作品计费挂钩；复制上方分享链接不受限 */
  const [rssGate, setRssGate] = useState<
    "idle" | "loading" | "ok" | "blocked" | "err"
  >("idle");
  const [rssGateDetail, setRssGateDetail] = useState("");

  const shareGenContextRef = useRef<ShareGenContext | null>(null);

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

  const applyJobToForm = useCallback(
    (row: Record<string, unknown>, displayTitleFallback: string) => {
      const result = (row.result || {}) as Record<string, unknown>;
      const jt = String(row.job_type || "").trim();
      setJobType(jt);
      const hex = String(result.audio_hex || "").trim();
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
      const sum = defaultSummaryFromJobResult(result);
      setScriptTextForLead(String(result.script_text || "").trim());

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

      setEpisodeTitle("");
      setSummary(sum);
      setShowNotes("正在根据口播稿与创作素材生成 Show Notes，请稍候…");

      initialSnapshotRef.current = {
        episodeTitle: "",
        summary: sum,
        showNotes: "正在根据口播稿与创作素材生成 Show Notes，请稍候…"
      };

      queueMicrotask(() => {
        const a = audioRef.current;
        if (!a) {
          setAudioReady(false);
          return;
        }
        const url = String(result.audio_url || "").trim();
        try {
          if (hex) {
            a.src = hexToMp3DataUrl(hex);
            setAudioReady(true);
          } else if (url) {
            a.src = url;
            setAudioReady(true);
          } else {
            setAudioReady(false);
          }
        } catch {
          setAudioReady(false);
        }
      });
    },
    [jobId]
  );

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setLoadErr("");
      setShareJobHydrated(false);
      setFormReady(false);
      setScriptBodyHint("");
      setScriptResolvePending(false);
      try {
        const row = await getJob(jobId);
        if (canceled) return;
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
            setScriptTextForLead(fullScript);
            if (!fullScript.trim()) {
              setScriptBodyHint("未找到完整口播稿，简介等将按任务摘要生成。");
            } else if (!needsArtifactPath) {
              setScriptBodyHint("已根据口播稿生成，可直接改。");
            } else if (fullScript.length > shortFrom.length) {
              setScriptBodyHint("已从存储补全文稿并重新生成。");
            } else if (fullScript.length < SCRIPT_TEXT_LIKELY_FULL_MIN_LEN) {
              setScriptBodyHint("正文较短，完整稿可在作品包 ZIP 中查看。");
            } else {
              setScriptBodyHint("已根据口播稿生成，可直接改。");
            }
          }
        } catch {
          if (!canceled) {
            setScriptBodyHint("正文加载失败，已用本地摘要。可刷新重试。");
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
        }

        const draft = loadShareFormDraft(jobId);
        const snap = initialSnapshotRef.current;
        if (draft && snap && !canceled) {
          const dFields: ShareFormFields = {
            episodeTitle: draft.episodeTitle,
            summary: draft.summary,
            showNotes: draft.showNotes
          };
          if (shareFormFieldsDiffer(dFields, snap)) {
            setDraftBanner(draft);
          }
        }
        if (!canceled) setFormReady(true);

        const pubs = await listRssPublicationsByJobIds([jobId]);
        const list = pubs[jobId] || [];
        if (list.length > 0) {
          setPublishedHint(`已曾发布到：${list.map((p) => p.channel_title).join("、")}`);
        } else {
          setPublishedHint("");
        }
      } catch (e) {
        if (!canceled) setLoadErr(String(e instanceof Error ? e.message : e));
      } finally {
        if (!canceled) setShareJobHydrated(true);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [jobId, applyJobToForm]);

  const scriptDraft = jobType === "script_draft";
  const audioBlocked = scriptDraft || !hasAudio;
  /** 未 hydration 前 blocked 为 false，避免误显分享区；仅 hydration 后才允许复制链接与发布表单。 */
  const showShareAndPublish = shareJobHydrated && !audioBlocked;

  useEffect(() => {
    let canceled = false;
    if (!shareJobHydrated || audioBlocked) {
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
  }, [jobId, shareJobHydrated, audioBlocked]);

  useEffect(() => {
    let canceled = false;
    if (rssGate !== "ok") {
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
  }, [rssGate]);

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
      const el = audioRef.current;
      if (!el || !hasAudio) {
        window.alert("无法跳转：无音频或未加载好。");
        return;
      }
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        el.currentTime = Math.min(Math.max(0, sec), Math.max(0, d - 0.05));
      } else {
        el.currentTime = Math.max(0, sec);
      }
      void el.play().catch(() => {});
    },
    [hasAudio]
  );

  function insertChapterOutline() {
    if (!chapterOutline?.length) return;
    const secs = chapterOutline.map((c) => Math.floor((c.start_ms || 0) / 1000));
    const allPresent = secs.length > 0 && secs.every((s) => new RegExp(`\\(t:${s}\\)`).test(showNotes));
    if (allPresent) {
      window.alert("章节时间戳已在正文里。");
      return;
    }
    const lines = formatChapterMarkdownLines(chapterOutline);
    setShowNotes((p) => `${p.trim() ? `${p.trim()}\n\n` : ""}${lines.join("\n")}`);
  }

  function applySmartTimestampLines() {
    setShowNotes((p) => promotePlainTimestampLinesInMarkdown(p));
  }

  function restoreDraft() {
    const d = draftBanner;
    if (!d) return;
    setEpisodeTitle(d.episodeTitle);
    setSummary(d.summary);
    setShowNotes(d.showNotes);
    setDraftBanner(null);
  }

  function discardDraft() {
    clearShareFormDraft(jobId);
    setDraftBanner(null);
    const snap = initialSnapshotRef.current;
    if (snap) {
      setEpisodeTitle(snap.episodeTitle);
      setSummary(snap.summary);
      setShowNotes(snap.showNotes);
    }
  }

  function fillSummaryFromScript() {
    const ctx = shareGenContextRef.current;
    const extra = ctx ? String(ctx.payload.text || "") : "";
    const s = deriveProgramSummaryOverallMax30(scriptTextForLead, extra);
    if (!s.trim()) {
      window.alert("没有口播稿，请手写简介。");
      return;
    }
    setSummary(s);
  }

  function regenerateShareMetadataFromScript() {
    const ctx = shareGenContextRef.current;
    if (!ctx) {
      window.alert("请稍后再试。");
      return;
    }
    if (!scriptTextForLead.trim() && !String(ctx.payload.text || "").trim()) {
      window.alert("没有文稿或素材，无法重新生成。");
      return;
    }
    const r = ctx.resultEarly;
    const rawCh = r.audio_chapters;
    const hasCh =
      Array.isArray(rawCh) &&
      rawCh.length > 0 &&
      rawCh.every((x) => x && typeof x === "object");
    const audioChaptersRaw = hasCh ? (rawCh as Record<string, unknown>[]) : undefined;
    const durRaw = r.audio_duration_sec;
    const audioDurationSec =
      typeof durRaw === "number" && Number.isFinite(durRaw)
        ? durRaw
        : typeof durRaw === "string" && String(durRaw).trim() !== ""
          ? Number.parseFloat(String(durRaw))
          : null;
    const derived = buildSharePublishCopyFromScriptAndPayload({
      scriptRaw: scriptTextForLead,
      payload: ctx.payload,
      result: r,
      displayTitleHint: ctx.displayTitleHint,
      audioChaptersRaw,
      audioDurationSec: Number.isFinite(audioDurationSec as number) ? audioDurationSec : null,
      fallbackTitle: sanitizeShareEpisodeTitle(ctx.titleFallbackRaw),
      fallbackSummary: defaultSummaryFromJobResult(r)
    });
    setSummary(derived.summary);
    setShowNotes(derived.showNotes);
    initialSnapshotRef.current = { ...derived, episodeTitle };
    setScriptBodyHint("已重新生成。");
  }

  async function submit() {
    setFormErr("");
    setFormOk("");
    if (publishPlatform !== "xiaoyuzhou") {
      setFormErr("请先在上方选择「小宇宙」并完成表单。");
      return;
    }
    if (rssGate !== "ok") {
      setFormErr(
        rssGateDetail.trim() || "当前账户或作品暂不符合 RSS 发布条件，请查看上方说明或完成充值/订阅后再试。"
      );
      return;
    }
    if (!channelId) {
      setFormErr("请选择频道。若列表为空，请先在设置里配置 RSS。");
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
        setFormErr("已开启定时发布，请先设置发布时间。");
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
      if (!window.confirm("简介为空，列表里可能不显示摘要。仍要发布？")) {
        return;
      }
    }
    if (h.summaryOverWarn && !h.summaryEmpty) {
      if (!window.confirm("简介很长，在部分 App 里会被截断。仍要发布？")) {
        return;
      }
    }

    setBusy(true);
    try {
      await publishWorkToRss({
        channel_id: channelId,
        job_id: jobId,
        title: episodeTitle.trim(),
        summary: summary.trim(),
        show_notes: showNotes.trim(),
        explicit: false,
        publish_at: schedulePublish && publishAt.trim() ? new Date(publishAt).toISOString() : undefined,
        force_republish: confirmRepublish
      });
      clearShareFormDraft(jobId);
      setDraftBanner(null);
      setFormOk(
        schedulePublish
          ? "已提交定时发布。到点后会在 RSS 中可见，各客户端同步有延迟。"
          : "已发布。各客户端同步有延迟，可在播客后台核对。"
      );
      try {
        const rows = await listRssPublicationsByJobIds([jobId]);
        const list = rows[jobId] || [];
        setPublishedHint(list.length > 0 ? `已发布过：${list.map((p) => p.channel_title).join("、")}` : "");
      } catch {
        /* ignore */
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("already_published_same_channel")) {
        setFormErr("该频道已发布过。勾选「覆盖已发布」后再试。");
      } else {
        setFormErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-2xl px-3 pb-12 pt-5 sm:px-4">
      <div className="mb-5 flex flex-col gap-1">
        <Link href="/works" className="text-sm text-brand hover:underline">
          ← 返回我的作品
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">发给朋友听</h1>
          {jobTitle ? <span className="max-w-[min(100%,14rem)] truncate text-xs text-muted sm:max-w-xs">{jobTitle}</span> : null}
        </div>
        <p className="text-xs text-muted">
          复制链接给好友听不限会员（公网域名）；使用下方 RSS 发布到播客平台时，需为充值/订阅等付费账户，且本片须为套餐或按量付费产生的成片。
        </p>
      </div>

      <audio ref={audioRef} className="hidden" preload="metadata" playsInline />

      {loadErr ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">{loadErr}</p>
      ) : null}

      {!loadErr && !shareJobHydrated ? (
        <p className="mb-4 rounded-lg border border-line bg-fill/60 px-3 py-2 text-sm text-muted" role="status">
          正在加载作品与音频信息…
        </p>
      ) : null}

      {draftBanner ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/35 bg-warning-soft/80 px-3 py-2 text-xs text-warning-ink">
          <span>有未保存的本地草稿</span>
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

      {showShareAndPublish && sharePageFullUrl ? (
        <section className="mb-5 rounded-2xl border border-brand/35 bg-brand/10 px-4 py-4 shadow-soft dark:bg-brand/15">
          <p className="text-sm font-semibold text-ink">先复制本页链接</p>
          <p className="mt-1 text-xs text-muted">收件人需登录本站打开链接；链接已固定为公网域名，便于转发。</p>
          <input
            readOnly
            value={sharePageFullUrl}
            className="mt-2 w-full cursor-text truncate rounded-lg border border-line bg-fill/50 px-3 py-2 font-mono text-[11px] text-ink"
            onFocus={(e) => e.target.select()}
            aria-label="分享页链接"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
              disabled={!sharePageFullUrl}
              onClick={() => void copySharePageLink()}
            >
              复制链接
            </button>
            {shareLinkCopied ? (
              <span className="text-xs font-medium text-success-ink dark:text-success-ink" role="status">
                已复制
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {shareJobHydrated && audioBlocked ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          {scriptDraft
            ? "该类型没有音频，无法在此页收听或发布；请从有口播成片的任务使用「发给朋友」。"
            : "还没有可分享的音频（或成品尚未同步）。请确认任务已成功完成后再试。"}
        </p>
      ) : null}

      {showShareAndPublish ? (
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

      {showShareAndPublish && advancedPublishOpen ? (
        <>
          <div className="mb-5">
            <p className="mb-2 text-xs font-medium text-ink">发布平台</p>
            <div className="flex flex-wrap gap-2">
              {PUBLISH_PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
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
            <p className="mt-2 text-[11px] text-muted/90">默认小宇宙；更多平台陆续开放。</p>
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
            {rssGate === "idle" ? "准备校验 RSS 发布条件…" : "正在校验 RSS 发布条件…"}
          </p>
        </div>
      ) : rssGate === "blocked" || rssGate === "err" ? (
        <div className="rounded-2xl border border-warning/35 bg-warning-soft/60 px-4 py-5 shadow-soft sm:px-6 sm:py-6">
          <p className="text-sm font-medium text-warning-ink">暂无法使用 RSS 发布</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-warning-ink/95">{rssGateDetail.trim() || "请稍后再试或刷新页面。"}</p>
          {rssGate === "blocked" ? <BillingShortfallLinks className="mt-4" /> : null}
          {rssGate === "err" ? (
            <p className="mt-3 text-xs text-muted">若持续失败请刷新页面或稍后重试。</p>
          ) : null}
        </div>
      ) : (
      <div className="rounded-2xl border border-line bg-surface px-4 py-5 shadow-soft sm:px-6 sm:py-6">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-ink">小宇宙 · 渠道与选项</h2>
            <label className="block text-sm text-muted">
              频道
              <select
                className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={channelsLoading || busy}
              >
                <option value="">{channelsLoading ? "加载中…" : "选择 RSS 频道"}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={confirmRepublish}
                onChange={(e) => setConfirmRepublish(e.target.checked)}
                disabled={busy}
                className="rounded border-line"
              />
              覆盖已发布（同一频道）
            </label>
          </section>

          <div className="border-t border-line pt-6">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-ink">标题与简介</h2>
                <button
                  type="button"
                  className="shrink-0 text-xs text-brand underline disabled:opacity-40"
                  disabled={busy || scriptResolvePending}
                  onClick={() => regenerateShareMetadataFromScript()}
                >
                  重新生成简介与 Shownotes
                </button>
              </div>
              <label className="block text-sm text-muted">
                节目标题
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                  value={episodeTitle}
                  onChange={(e) => setEpisodeTitle(e.target.value)}
                  disabled={busy}
                  maxLength={300}
                  placeholder={
                    jobTitle
                      ? `请输入标题（可与作品名一致：${jobTitle.length > 40 ? `${jobTitle.slice(0, 40)}…` : jobTitle}）`
                      : "请输入节目标题（将写入 RSS / 小宇宙）"
                  }
                />
                <span className="mt-1 block text-[11px] text-muted/90">由你填写，系统不再自动从口播稿生成标题。</span>
                <span className="mt-0.5 flex justify-end text-[11px] tabular-nums text-muted/80">
                  <span className={hints.titleOverSoft ? "text-warning-ink" : ""}>{episodeTitle.length}</span>
                  <span className="text-muted/60">/{SHARE_TITLE_SOFT_MAX}</span>
                </span>
              </label>
              <div className="text-sm text-muted">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>简介</span>
                  <button
                    type="button"
                    className="text-xs text-brand underline disabled:opacity-40"
                    disabled={busy || !scriptTextForLead || scriptResolvePending}
                    onClick={() => fillSummaryFromScript()}
                  >
                    重写（约 {AUTO_PROGRAM_SUMMARY_MAX} 字内）
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted/90">
                  提炼本期讨论主线，约 {AUTO_PROGRAM_SUMMARY_MAX} 字以内、通俗有吸引力；不满意可点「重写」或手改。
                </p>
                {scriptBodyHint ? <p className="mt-1 text-[11px] text-muted/90">{scriptBodyHint}</p> : null}
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm text-ink"
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={busy}
                  maxLength={4000}
                  placeholder={`列表摘要，建议 ${AUTO_PROGRAM_SUMMARY_MAX} 字以内`}
                />
                <span className="mt-0.5 flex justify-end text-[11px] tabular-nums text-muted/80">
                  <span
                    className={
                      summary.length > SHARE_SUMMARY_WARN_MAX
                        ? "font-medium text-danger-ink"
                        : summary.length > SHARE_SUMMARY_IDEAL_MAX
                          ? "text-warning-ink"
                          : ""
                    }
                  >
                    {summary.length}
                  </span>
                  <span className="text-muted/60"> 字</span>
                </span>
                {hints.summaryLooksLikeDialogue ? (
                  <p className="mt-1 text-[11px] text-warning-ink">疑似对白格式，听众在列表里会读起来怪。</p>
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
                  默认包含：本期主题、关键收获、时间轴、金句与资源；支持 Markdown。时间跳转{" "}
                  <code className="rounded bg-fill px-1">[3:20 标题](t:200)</code>
                  {audioReady ? "，预览里可点。" : "。"}
                </p>
              ) : null}
              {notesTab === "edit" ? (
                <textarea
                  className="w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 font-mono text-sm leading-relaxed text-ink"
                  rows={12}
                  value={showNotes}
                  onChange={(e) => setShowNotes(e.target.value)}
                  disabled={busy}
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {chapterOutline && chapterOutline.length > 0 ? (
                  <button type="button" className="text-xs text-brand underline" onClick={() => insertChapterOutline()}>
                    插入章节
                  </button>
                ) : null}
                <button type="button" className="text-xs text-brand underline" onClick={() => applySmartTimestampLines()} disabled={busy}>
                  识别分:秒 行
                </button>
              </div>
              {hints.showNotesVeryShort ? (
                <p className="text-[11px] text-warning-ink">内容偏少，可补链接或时间轴。</p>
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
                disabled={busy || !showShareAndPublish}
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
                  disabled={busy || !showShareAndPublish}
                  onClick={() => openScheduleModal()}
                >
                  {formatSchedulePreview(publishAt)}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="min-w-[7rem] rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
              disabled={busy || !showShareAndPublish || publishPlatform !== "xiaoyuzhou"}
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
              className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
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
                <p className="mt-1 text-xs text-muted">选择 RSS 中该集的可见时间（各平台抓取有延迟）。</p>
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
