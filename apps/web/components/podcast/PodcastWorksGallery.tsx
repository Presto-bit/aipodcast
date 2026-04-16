"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { hexToMp3DataUrl } from "../../lib/audioHex";
import { useAuth } from "../../lib/auth";
import { GatedSplitAction } from "../SubscriptionVipLink";
import { scheduleCloudPreferencesPush } from "../../lib/cloudPreferences";
import { blobToDataUrlBase64, cropSquareToPodcastCoverJpeg } from "../../lib/podcastCoverImage";
import { sanitizeShareEpisodeTitle } from "../../lib/sharePublishDefaults";
import { downloadJobBundleZip, downloadJobManuscriptMarkdown } from "../../lib/workBundleDownload";
import { listRssPublicationsByJobIds, type RssPublication } from "../../lib/api";
import type { WorkItem } from "../../lib/worksTypes";
import { useI18n } from "../../lib/I18nContext";
import { resolveJobScriptBodyText } from "../../lib/jobScriptText";
import { insertPodcastDraftAtTop, setDraftsNavigationFocusDraftId } from "../../lib/podcastDrafts";
import { readLocalStorageScoped, writeLocalStorageScoped, writeSessionStorageScoped } from "../../lib/userScopedStorage";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";

function workDownloadAllowed(w: Pick<WorkItem, "downloadAllowed">): boolean {
  return w.downloadAllowed === true;
}

const PODCAST_TYPES = new Set(["podcast_generate", "podcast", "podcast_short_video"]);
const TTS_TYPES = new Set(["text_to_speech", "tts"]);
/** 笔记本出稿（script_draft） */
const NOTES_WORK_TYPES = new Set(["script_draft"]);
/** 笔记本页：成片 + 文章出稿 */
const NOTES_STUDIO_TYPES = new Set(["podcast_generate", "podcast", "script_draft"]);

function isPodcastManuscriptDraftTarget(jobType: string): boolean {
  const t = String(jobType || "").trim();
  return t === "podcast_generate" || t === "podcast";
}

/** 「我的作品」导航页音频合并列表：一级体裁 */
function worksNavPrimaryKind(type: string | undefined): string {
  const t = String(type || "");
  if (t === "script_draft") return "文章";
  if (TTS_TYPES.has(t)) return "文字转语音";
  return "播客";
}

/** 二级体裁：payload.program_name；缺失时按一级给默认（播客→「播客」等） */
function worksNavSecondaryLabel(w: WorkItem, primaryKind: string): string {
  const p = String(w.workProgramName || "").trim();
  if (p) return p;
  if (primaryKind === "文章") return "文章";
  if (primaryKind === "文字转语音") return "配音";
  return "播客";
}

function worksNavMetricPart(
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null
): string {
  if (isScriptDraft) {
    return scriptCharCountDisplay != null && scriptCharCountDisplay > 0
      ? `约 ${Math.round(scriptCharCountDisplay).toLocaleString()} 字`
      : "—";
  }
  return durationLine !== "—" ? `时长 ${durationLine}` : "—";
}

/** 作品列表/详情：年月日 + 24 小时制时分 */
function formatWorkCreatedAtZh(createdAt: string | undefined): string {
  const raw = String(createdAt || "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

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
function coverImageSrc(url: string | undefined | null, cacheBust?: number): string {
  const u = String(url || "").trim();
  if (!u) return "";
  let base = u.startsWith("data:") || u.startsWith("/") ? u : `/api/image-proxy?url=${encodeURIComponent(u)}`;
  if (cacheBust && base.startsWith("/")) {
    base += `${base.includes("?") ? "&" : "?"}v=${cacheBust}`;
  }
  return base;
}

function loadHiddenIds(hiddenKey: string): Set<string> {
  try {
    const raw = readLocalStorageScoped(hiddenKey);
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
    writeLocalStorageScoped(hiddenKey, JSON.stringify([...s]));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
}

function loadTitles(titlesKey: string): Record<string, string> {
  try {
    const raw = readLocalStorageScoped(titlesKey);
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
    writeLocalStorageScoped(titlesKey, JSON.stringify(m));
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
  onClick,
  compact
}: {
  playing: boolean;
  progress: number;
  disabled?: boolean;
  onClick: () => void;
  /** 笔记本侧栏紧凑卡片用 */
  compact?: boolean;
}) {
  const r = compact ? 32 : 41;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - p);
  const wrap = compact ? "h-9 w-9" : "h-11 w-11";
  const btn = compact ? "h-6 w-6" : "h-7 w-7";
  const iconSm = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  const iconPlay = compact ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <div className={`relative inline-flex ${wrap} shrink-0 items-center justify-center`}>
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
        className={`relative z-[1] flex ${btn} cursor-pointer items-center justify-center rounded-full bg-surface text-brand shadow-soft outline-none ring-offset-2 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-60`}
      >
        {playing ? (
          <svg className={iconSm} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg className={`ml-px ${iconPlay}`} viewBox="0 0 24 24" fill="currentColor">
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
  /** 播客成片（默认）、TTS、笔记本出稿、笔记本页合并列表，或首页「全部类型」 */
  variant?: "podcast" | "tts" | "notes" | "notes_studio" | "all";
  /** 仅在作品管理页开启：支持批量下载入口 */
  enableBatchActions?: boolean;
  /** 笔记页侧栏：仅展示前 N 条，其余通过「更多」跳转我的作品 */
  sidebarMaxItems?: number;
};

const NOTE_TITLE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function humanNoteSourceLabel(raw: string): string {
  const s = String(raw || "").trim();
  if (!s || NOTE_TITLE_UUID_RE.test(s)) return "未命名笔记";
  return s;
}

/**
 * 笔记本侧栏「我的作品」卡片简介：体裁 · 来源笔记名 · 时长或字数 · 生成时间
 */
/** 笔记本侧栏 ⋯ 菜单：fixed 定位，避免 overflow/滚动裁切 */
function computeNotesStudioMenuPosition(anchor: DOMRect): { top: number; left: number } {
  const MENU_PAD = 8;
  const MENU_W = 152;
  const GAP = 4;
  const EST_HEIGHT = 220;
  let left = anchor.right - MENU_W;
  left = Math.min(Math.max(MENU_PAD, left), window.innerWidth - MENU_W - MENU_PAD);
  let top = anchor.bottom + GAP;
  if (top + EST_HEIGHT > window.innerHeight - MENU_PAD) {
    top = Math.max(MENU_PAD, anchor.top - EST_HEIGHT - GAP);
  }
  return { top, left };
}

/** 无本地改名时侧栏卡片首行：引用笔记等推导出的作品名称（完整） */
function notesStudioReferencedWorkTitle(w: PodcastWorkRow): string {
  const rawTitles = Array.isArray(w.notesSourceTitles) ? w.notesSourceTitles : [];
  const labeled = rawTitles.map((t) => humanNoteSourceLabel(String(t)));
  const firstTitle = labeled.find((t) => t && t !== "未命名笔记") || labeled[0] || "";
  const nTotal =
    typeof w.notesSourceNoteCount === "number" && w.notesSourceNoteCount > 0 ? w.notesSourceNoteCount : rawTitles.length;
  if (firstTitle) return firstTitle;
  if (nTotal > 0) return `已选 ${nTotal} 条笔记`;
  return "引用来源未记录";
}

/**
 * 侧栏卡片首行：用户通过「修改名称」保存的标题优先，否则为引用来源的作品名称。
 */
function notesStudioCardHeadlineTitle(
  w: PodcastWorkRow,
  titleOverrides: Record<string, string>,
  jobId: string
): string {
  const saved = jobId && titleOverrides[jobId] ? String(titleOverrides[jobId]).trim() : "";
  if (saved) return saved;
  return notesStudioReferencedWorkTitle(w);
}

const NOTES_STUDIO_REF_TITLE_MAX_CHARS = 24;

function truncateByGraphemes(s: string, maxChars: number): string {
  const t = String(s || "").trim();
  if (maxChars < 1) return "";
  const chars = Array.from(t);
  if (chars.length <= maxChars) return t;
  return chars.slice(0, maxChars).join("") + "…";
}

/** 第二行：体裁 · 时长/字数 · 时间（不含引用标题，避免与首行重复） */
function formatNotesStudioCardMetaLine(
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null,
  createdShort: string
): string {
  const genre = isScriptDraft ? "文章" : "播客";
  const metric = isScriptDraft
    ? scriptCharCountDisplay != null && scriptCharCountDisplay > 0
      ? `约 ${Math.round(scriptCharCountDisplay).toLocaleString()} 字`
      : "—"
    : durationLine !== "—"
      ? `时长 ${durationLine}`
      : "—";
  return `${genre} · ${metric} · ${createdShort}`;
}

/** 悬停层完整一行（含《引用》），供摘要提示使用 */
function formatNotesStudioCardSynopsis(
  w: PodcastWorkRow,
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null,
  createdShort: string
): string {
  const genre = isScriptDraft ? "文章" : "播客";
  const rawTitles = Array.isArray(w.notesSourceTitles) ? w.notesSourceTitles : [];
  const labeled = rawTitles.map((t) => humanNoteSourceLabel(String(t)));
  const firstTitle = labeled.find((t) => t && t !== "未命名笔记") || labeled[0] || "";
  const nTotal =
    typeof w.notesSourceNoteCount === "number" && w.notesSourceNoteCount > 0 ? w.notesSourceNoteCount : rawTitles.length;
  const sourcePart = firstTitle
    ? `《${firstTitle}》`
    : nTotal > 0
      ? `已选 ${nTotal} 条笔记`
      : "来源未记录";
  const metric = isScriptDraft
    ? scriptCharCountDisplay != null && scriptCharCountDisplay > 0
      ? `约 ${Math.round(scriptCharCountDisplay).toLocaleString()} 字`
      : "—"
    : durationLine !== "—"
      ? `时长 ${durationLine}`
      : "—";
  return `${genre} · ${sourcePart} · ${metric} · ${createdShort}`;
}

/** 文章出稿卡片：单行来源 + 悬停/聚焦浮层展示笔记本、引用笔记全名等 */
function ScriptWorkSourceSummary({ w, compact }: { w: PodcastWorkRow; compact?: boolean }) {
  const rawTitles = Array.isArray(w.notesSourceTitles) ? w.notesSourceTitles : [];
  const titles = rawTitles.map((t) => humanNoteSourceLabel(String(t)));
  const nTotal =
    typeof w.notesSourceNoteCount === "number" && w.notesSourceNoteCount > 0
      ? w.notesSourceNoteCount
      : titles.length;
  const joined = titles.join(" · ");
  const moreHint =
    nTotal > titles.length ? `共勾选 ${nTotal} 条，以下仅列出前 ${titles.length} 条名称。` : "";
  const sourceOneLine =
    titles.length > 0
      ? `来源：${joined}`
      : nTotal > 0
        ? `来源：已勾选 ${nTotal} 条笔记（名称未记录）`
        : "来源：—";
  const nb = String(w.notesSourceNotebook || "").trim();
  const showHoverPanel = titles.length > 0 || nTotal > 0 || Boolean(nb);

  if (compact) {
    return (
      <p className="line-clamp-2 text-[9px] leading-snug text-muted" title={sourceOneLine}>
        {sourceOneLine}
      </p>
    );
  }

  return (
    <>
      <div
        className={`group/source relative min-w-0 outline-none ${showHoverPanel ? "cursor-default" : ""}`}
        tabIndex={showHoverPanel ? 0 : undefined}
        aria-label={showHoverPanel ? "来源详情：悬停或按 Tab 聚焦后查看" : undefined}
      >
        <p className="truncate text-[11px] leading-snug text-ink/90">{sourceOneLine}</p>
        {showHoverPanel ? (
          <div
            className="invisible absolute left-0 top-full z-[60] pt-1 opacity-0 transition-opacity duration-150 group-hover/source:visible group-hover/source:opacity-100 group-focus-within/source:visible group-focus-within/source:opacity-100"
            role="tooltip"
          >
            <div className="w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-[11px] leading-relaxed text-ink shadow-card ring-1 ring-line/60">
              <div className="font-semibold text-ink">来源详情</div>
              {nb ? (
                <p className="mt-1.5 text-muted">
                  笔记本 <span className="text-ink/90">「{nb}」</span>
                </p>
              ) : null}
              {titles.length > 0 ? (
                <>
                  <p className="mt-2 font-medium text-ink/90">引用笔记</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-ink">
                    {titles.map((t, idx) => (
                      <li key={`${idx}-${t.slice(0, 24)}`}>{t}</li>
                    ))}
                  </ul>
                </>
              ) : nTotal > 0 ? (
                <p className="mt-2 text-muted">已选 {nTotal} 条（无标题）</p>
              ) : null}
              {moreHint ? (
                <p className="mt-2 border-t border-line/80 pt-2 text-[10px] text-muted">{moreHint}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

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
  enableBatchActions = false,
  sidebarMaxItems
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const { getAuthHeaders, user } = useAuth();
  const workAudio = useWorkAudioPlayer();

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
  const { hiddenKey, titlesKey, allowedTypes } = useMemo(() => galleryStorageKeys(variant), [variant]);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setHidden(loadHiddenIds(hiddenKey));
    setTitleOverrides(loadTitles(titlesKey));
  }, [hiddenKey, titlesKey]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  /** notes_studio：菜单挂在 portal 上，用于点击外部判断 */
  const notesStudioMenuPortalRef = useRef<HTMLDivElement | null>(null);
  const [notesStudioMenuPos, setNotesStudioMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renameJobId, setRenameJobId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [publicationsByJobId, setPublicationsByJobId] = useState<Record<string, RssPublication[]>>({});

  const [coverBustById, setCoverBustById] = useState<Record<string, number>>({});
  const [coverUploadBusy, setCoverUploadBusy] = useState<string | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const coverUploadTargetIdRef = useRef<string | null>(null);

  const {
    activeJobId,
    isPlaying: isPlayingAudio,
    progress01,
    durationSec,
    loadingJobId: audioLoadingId,
    playError: activePlayError,
    togglePlay: toggleWorkAudio,
    dismissIfJob,
    clearCachedAudioSrc
  } = workAudio;
  const togglePlay = useCallback(
    (jobId: string, displayTitle: string) => {
      setPlayErrorById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      void toggleWorkAudio(jobId, { displayTitle });
    },
    [toggleWorkAudio]
  );
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
      displayTitle:
        (w.id && titleOverrides[w.id]) ||
        sanitizeShareEpisodeTitle(String(w.title || ""), "") ||
        String(w.title || "").trim() ||
        w.id ||
        "未命名"
    }));
  }, [works, hidden, titleOverrides, allowedTypes]);

  const visibleItems = useMemo(() => {
    const cap = typeof sidebarMaxItems === "number" && sidebarMaxItems > 0 ? sidebarMaxItems : 0;
    if (variant !== "notes_studio" || cap < 1) return items;
    return items.slice(0, cap);
  }, [items, variant, sidebarMaxItems]);

  const sidebarMoreCount = useMemo(() => {
    const cap = typeof sidebarMaxItems === "number" && sidebarMaxItems > 0 ? sidebarMaxItems : 0;
    if (variant !== "notes_studio" || cap < 1) return 0;
    return Math.max(0, items.length - cap);
  }, [items.length, variant, sidebarMaxItems]);

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

  const notesStudioMenuPortalData = useMemo(() => {
    if (variant !== "notes_studio" || !menuOpenId) return null;
    const w = items.find((x) => x.id === menuOpenId);
    if (!w?.id) return null;
    const id = w.id;
    const pubs = publicationsByJobId[id] || [];
    const isScriptDraft = String(w.type || "") === "script_draft";
    return {
      w,
      id,
      isScriptDraft,
      publishActionText: pubs.length > 0 ? "已发过" : "分享"
    };
  }, [variant, menuOpenId, items, publicationsByJobId]);

  /** 我的作品 / 首页合并列表：⋯ 菜单用 portal，避免卡片 overflow 裁切与网格叠层遮挡 */
  const worksGridMenuPortalData = useMemo(() => {
    if (!menuOpenId || variant === "notes_studio") return null;
    const w = items.find((x) => x.id === menuOpenId);
    if (!w?.id) return null;
    const id = w.id;
    const isScriptDraft = String(w.type || "") === "script_draft";
    const pubs = publicationsByJobId[id] || [];
    const publishActionText = pubs.length > 0 ? "已发过" : "分享";
    if (variant === "all") {
      return { layout: "toolbar" as const, w, id, isScriptDraft };
    }
    return { layout: "card" as const, w, id, isScriptDraft, publishActionText };
  }, [variant, menuOpenId, items, publicationsByJobId]);

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
          const audioUrl = String(result.audio_url || "").trim();
          if (!hex && !audioUrl) {
            durationResolvedRef.current.add(id);
            return;
          }
          const a = document.createElement("audio");
          a.preload = "metadata";
          a.src = hex ? hexToMp3DataUrl(hex) : audioUrl;
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
      if (menuWrapRef.current?.contains(t)) return;
      if (notesStudioMenuPortalRef.current?.contains(t)) return;
      setMenuOpenId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useLayoutEffect(() => {
    if (!menuOpenId) {
      setNotesStudioMenuPos(null);
      return;
    }
    const update = () => {
      const el = menuWrapRef.current;
      if (!el) {
        requestAnimationFrame(() => {
          const el2 = menuWrapRef.current;
          if (!el2) return;
          setNotesStudioMenuPos(computeNotesStudioMenuPosition(el2.getBoundingClientRect()));
        });
        return;
      }
      setNotesStudioMenuPos(computeNotesStudioMenuPosition(el.getBoundingClientRect()));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [menuOpenId]);

  const onDownload = useCallback(async (row: PodcastWorkRow) => {
    if (!workDownloadAllowed(row)) return;
    const id = String(row.id || "").trim();
    if (!id) return;
    setMenuOpenId(null);
    setZipBusy(id);
    const title = String(row.displayTitle || row.title || id).trim() || id;
    try {
      if (String(row.type || "") === "script_draft") {
        await downloadJobManuscriptMarkdown({ jobId: id, title });
      } else {
        await downloadJobBundleZip({ jobId: id, title });
      }
    } catch (e) {
      setPlayErrorById((prev) => ({
        ...prev,
        [id]: `下载失败：${e instanceof Error ? e.message : String(e)}`
      }));
    } finally {
      setZipBusy(null);
    }
  }, []);

  function downloadBusyLabel(workType: string | undefined): string {
    return String(workType || "") === "script_draft" ? "正在下载…" : "正在打包…";
  }

  function downloadLabelForWorkType(type: string | undefined): string {
    const t = String(type || "");
    if (t === "script_draft") return "下载 Markdown 文稿";
    return "下载（音频·文稿·配图）";
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
            // 成品走硬删（purge），避免仅软删未生效时刷新仍出现；与「进行中」任务删除同一套接口
            res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/purge`, {
              method: "POST",
              credentials: "same-origin",
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
          clearCachedAudioSrc(jobId);
          dismissIfJob(jobId);
          setHydratedDurationSec((prev) => {
            const next = { ...prev };
            delete next[jobId];
            return next;
          });
          durationResolvedRef.current.delete(jobId);
          durationFetchRef.current.delete(jobId);
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
        clearCachedAudioSrc(jobId);
        dismissIfJob(jobId);
        setHydratedDurationSec((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        durationResolvedRef.current.delete(jobId);
        durationFetchRef.current.delete(jobId);
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
    [dismissIfJob, clearCachedAudioSrc, onWorkDeleted, titlesKey, hiddenKey, getAuthHeaders]
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
  const batchAllSelectedAllowDownload =
    selectedRows.length > 0 && selectedRows.every((w) => workDownloadAllowed(w));

  const goToSharePage = useCallback(
    (work: PodcastWorkRow) => {
      const id = String(work.id || "").trim();
      if (!id) return;
      setMenuOpenId(null);
      try {
        writeSessionStorageScoped(`fym_share_display_title:${id}`, work.displayTitle);
      } catch {
        /* ignore */
      }
      router.push(`/works/share/${id}`);
    },
    [router]
  );

  async function uploadCoverForJob(jobId: string, file: File) {
    if (file.size > 8 * 1024 * 1024) {
      window.alert("封面图片需不超过 8MB");
      return;
    }
    setCoverUploadBusy(jobId);
    setMenuOpenId(null);
    try {
      const jpegBlob = await cropSquareToPodcastCoverJpeg(file);
      const { base64: image_base64 } = await blobToDataUrlBase64(jpegBlob);
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cover`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          image_base64,
          content_type: "image/jpeg"
        })
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setCoverBustById((prev) => ({ ...prev, [jobId]: Date.now() }));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "封面上传失败");
    } finally {
      setCoverUploadBusy(null);
      coverUploadTargetIdRef.current = null;
    }
  }

  async function onReuseTemplate(id: string) {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store", headers: { ...getAuthHeaders() } });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error("读取作品参数失败");
      const jobType = String(row.job_type || "").trim();
      if (jobType === "podcast_short_video") {
        throw new Error("短视频功能已下线，请从播客成片或语音作品直接复用参数。");
      }
      const payload = (row.payload || {}) as Record<string, unknown>;
      const result = (row.result || {}) as Record<string, unknown>;

      if (isPodcastManuscriptDraftTarget(jobType)) {
        /** 正文在 result.script_text / script 工件；勿用 payload.text（多为原始素材）。 */
        const text = (await resolveJobScriptBodyText(id, row, getAuthHeaders())).trim();
        if (!text) {
          window.alert("暂无文稿可复制");
          return;
        }
        const titleFromJob = String((row as { title?: unknown }).title || payload.title || "").trim();
        const draftTitle = (sanitizeShareEpisodeTitle(titleFromJob, "") || titleFromJob || "播客文稿").slice(0, 200);
        const newId = insertPodcastDraftAtTop({ title: draftTitle, text });
        setDraftsNavigationFocusDraftId(newId);
        router.push("/drafts");
        return;
      }

      if (jobType === "text_to_speech" || jobType === "tts") {
        writeSessionStorageScoped(
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
        writeSessionStorageScoped(
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

      writeSessionStorageScoped(
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
        [id]: `操作失败：${e instanceof Error ? e.message : String(e)}`
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
    const rows = selectedRows.filter((w) => workDownloadAllowed(w));
    if (rows.length === 0) return;
    setBatchBusy(true);
    try {
      for (const row of rows) {
        if (!row.id) continue;
        const title = row.displayTitle || row.title || row.id;
        if (String(row.type || "") === "script_draft") {
          await downloadJobManuscriptMarkdown({ jobId: row.id, title });
        } else {
          await downloadJobBundleZip({ jobId: row.id, title });
        }
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
        message={`确定删除「${pendingDeleteTitle}」吗？将从服务器彻底移除该作品，不可恢复；本机显示名称缓存会清除。`}
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

      <input
        ref={coverFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const jid = coverUploadTargetIdRef.current;
          e.target.value = "";
          if (f && jid) void uploadCoverForJob(jid, f);
        }}
      />

      {fetchError ? (
        <div className="mb-2 text-sm text-danger-ink">
          <p>
            {fetchError}
            {onDismissError ? (
              <button type="button" className="ml-2 underline" onClick={onDismissError}>
                清除
              </button>
            ) : null}
          </p>
          {messageSuggestsBillingTopUpOrSubscription(fetchError) ? <BillingShortfallLinks className="mt-2" /> : null}
        </div>
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
              {selectedCount === 0 ? (
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink opacity-50"
                  disabled
                >
                  批量下载
                </button>
              ) : batchAllSelectedAllowDownload ? (
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill disabled:opacity-50"
                  disabled={batchBusy}
                  onClick={() => void batchDownloadSelected()}
                >
                  {batchBusy ? "正在批量下载…" : "批量下载"}
                </button>
              ) : (
                <GatedSplitAction
                  locked
                  variant="default"
                  upgradeTitle="下载需订阅"
                  onClick={() => {}}
                  disabled={false}
                  unlockedClassName="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill disabled:opacity-50"
                >
                  {batchBusy ? "正在批量下载…" : "批量下载"}
                </GatedSplitAction>
              )}
              <button
                type="button"
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink hover:bg-fill"
                onClick={() => setSelectedIds(new Set())}
              >
                清空选择
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="fym-empty-state py-10 text-center text-sm text-muted">{t("gallery.loading")}</div>
      ) : items.length === 0 ? (
        <div className="fym-empty-state py-14 text-center text-sm leading-relaxed text-muted">
          {variant === "tts"
            ? t("gallery.empty.tts")
            : variant === "notes"
              ? t("gallery.empty.notes")
              : variant === "notes_studio"
                ? t("gallery.empty.notesStudio")
                : variant === "all"
                  ? t("gallery.empty.all")
                  : t("gallery.empty.podcast")}
        </div>
      ) : (
        <>
        <ul
          className={
            variant === "notes_studio"
              ? "grid w-full grid-cols-1 gap-2 overflow-visible"
              : "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          }
        >
          {visibleItems.map((w) => {
            const id = w.id!;
            const isScriptDraft = String(w.type || "") === "script_draft";
            const isActive = activeJobId === id;
            const rowPlayMsg = (isActive && activePlayError) || playErrorById[id];
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
            const created = formatWorkCreatedAtZh(w.createdAt);
            const createdShort = created;
            const publications = publicationsByJobId[id] || [];
            const publishedText =
              publications.length > 0
                ? `已在 ${publications.length} 处发布 · ${publications[0]?.channel_title || ""}`
                : "";
            const publishActionText = publications.length > 0 ? "已发过" : "分享";
            const scriptCharCountDisplay =
              typeof w.scriptCharCount === "number" &&
              Number.isFinite(w.scriptCharCount) &&
              w.scriptCharCount > 0
                ? Math.round(w.scriptCharCount)
                : null;
            const reuseOrManuscriptLabel = isPodcastManuscriptDraftTarget(String(w.type || "")) ? "修改文稿" : "复用";

            /** 仅笔记本工作台侧栏「我的作品」：无封面顶栏、简介 + 标题 + 操作；其它页面仍走下方默认卡片 */
            if (variant === "notes_studio") {
              const headlineFull = notesStudioCardHeadlineTitle(w, titleOverrides, id);
              const headlineShown = truncateByGraphemes(headlineFull, NOTES_STUDIO_REF_TITLE_MAX_CHARS);
              const metaLine = formatNotesStudioCardMetaLine(
                isScriptDraft,
                durationLine,
                scriptCharCountDisplay,
                createdShort
              );
              const synopsisHoverFull = formatNotesStudioCardSynopsis(
                w,
                isScriptDraft,
                durationLine,
                scriptCharCountDisplay,
                createdShort
              );
              return (
                <li
                  key={id}
                  className="relative flex w-full min-w-0 max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
                >
                  {enableBatchActions && batchMode ? (
                    <label className="flex items-center gap-2 border-b border-line bg-fill/40 px-2 py-1 text-[10px] text-ink">
                      <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelect(id)} />
                      选择
                    </label>
                  ) : null}
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
                    {headlineFull !== headlineShown ? (
                      <div className="group/reftitle relative min-h-0">
                        <p className="line-clamp-2 min-h-0 text-[11px] font-semibold leading-tight text-ink">{headlineShown}</p>
                        <div
                          role="tooltip"
                          className="pointer-events-none invisible absolute bottom-full left-0 z-[70] mb-1 w-max max-w-[min(18rem,90vw)] rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[10px] font-normal leading-snug text-ink opacity-0 shadow-card ring-1 ring-line/50 transition-opacity delay-[75ms] duration-100 group-hover/reftitle:visible group-hover/reftitle:opacity-100"
                        >
                          {headlineFull}
                        </div>
                      </div>
                    ) : (
                      <p className="line-clamp-2 min-h-0 text-[11px] font-semibold leading-tight text-ink">{headlineShown}</p>
                    )}
                    <div className="group/synopsis relative min-h-0">
                      <p className="line-clamp-3 min-h-0 text-[9px] leading-snug text-muted">{metaLine}</p>
                      <div
                        role="tooltip"
                        className="pointer-events-none invisible absolute bottom-full left-0 z-[70] mb-1 w-max max-w-[min(18rem,92vw)] whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[9px] leading-snug text-ink opacity-0 shadow-card ring-1 ring-line/50 transition-opacity delay-[75ms] duration-100 group-hover/synopsis:visible group-hover/synopsis:opacity-100"
                      >
                        {synopsisHoverFull}
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-1 border-t border-line/50 pt-1.5">
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        {!isScriptDraft ? (
                          <CircularPlayControl
                            playing={isActive && isPlayingAudio}
                            progress={prog}
                            disabled={audioLoadingId === id}
                            onClick={() => void togglePlay(id, w.displayTitle)}
                            compact
                          />
                        ) : null}
                      </div>
                      <div className="relative shrink-0" ref={menuOpenId === id ? menuWrapRef : undefined}>
                        <button
                          type="button"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-fill"
                          aria-label="更多"
                          aria-expanded={menuOpenId === id}
                          onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
                        >
                          <span className="text-sm leading-none">⋯</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  {renameJobId === id ? (
                    <div className="border-t border-line px-2 py-1.5">
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
                  {rowPlayMsg ? (
                    <p
                      className="border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[8px] leading-tight text-danger-ink"
                      role="status"
                    >
                      {rowPlayMsg}
                    </p>
                  ) : null}
                </li>
              );
            }

            if (variant === "all") {
              const primaryK = worksNavPrimaryKind(w.type);
              const secondaryK = worksNavSecondaryLabel(w, primaryK);
              const metricP = worksNavMetricPart(isScriptDraft, durationLine, scriptCharCountDisplay);
              const dayP = formatWorkCreatedAtZh(w.createdAt);
              /** 合并列表播客行不再展示节目名（如默认「本期播客」），避免与一级体裁重复 */
              const secondaryForNav = primaryK === "播客" ? "" : secondaryK;
              const navMetaLine = [primaryK, secondaryForNav, worksNavAuthorDisplay, metricP, dayP]
                .map((s) => String(s || "").trim())
                .filter(Boolean)
                .join(" | ");
              return (
                <li
                  key={id}
                  className="relative flex w-full max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
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
                  {isScriptDraft ? (
                    <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t-xl border-b border-success/25 bg-gradient-to-br from-success-soft/50 to-success/[0.08]">
                      <div className="flex h-full flex-col items-center justify-center gap-1 p-2">
                        <span className="text-2xl leading-none opacity-90" aria-hidden>
                          📝
                        </span>
                        <span className="text-[10px] font-medium text-success-ink/90">文稿</span>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t-xl bg-gradient-to-br from-fill to-fill">
                      {w.coverImage ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={coverImageSrc(w.coverImage, coverBustById[id])}
                          alt=""
                          className="relative z-[1] h-full w-full object-cover"
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
                      ) : (
                        <div className="flex h-full min-h-[3rem] items-center justify-center text-[10px] text-muted">无配图</div>
                      )}
                    </div>
                  )}
                  <div className="shrink-0 border-b border-line/70 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink line-clamp-2" title={w.displayTitle}>
                        {w.displayTitle}
                      </p>
                      {!isScriptDraft ? (
                        <div className="shrink-0 pt-0.5">
                          <CircularPlayControl
                            playing={isActive && isPlayingAudio}
                            progress={prog}
                            disabled={audioLoadingId === id}
                            onClick={() => void togglePlay(id, w.displayTitle)}
                            compact
                          />
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted" title={navMetaLine}>
                      {navMetaLine}
                    </p>
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
                  {rowPlayMsg ? (
                    <p
                      className="border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[9px] leading-tight text-danger-ink"
                      role="status"
                    >
                      {rowPlayMsg}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-fill/30 px-2 py-1.5 text-[11px]">
                    {!isScriptDraft ? (
                      <button
                        type="button"
                        className="rounded-md border border-line bg-surface px-2 py-1 font-medium text-ink hover:bg-fill disabled:opacity-50"
                        disabled={audioLoadingId === id}
                        onClick={() => void togglePlay(id, w.displayTitle)}
                      >
                        {isActive && isPlayingAudio ? "暂停" : "播放"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15 disabled:pointer-events-none disabled:opacity-40"
                      onClick={() => goToSharePage(w)}
                    >
                      {publishActionText}
                    </button>
                    <GatedSplitAction
                      locked={!workDownloadAllowed(w)}
                      variant="default"
                      upgradeTitle="下载需订阅"
                      onClick={() => void onDownload(w)}
                      disabled={zipBusy === id}
                      unlockedClassName="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40"
                    >
                      {zipBusy === id ? downloadBusyLabel(w.type) : "下载"}
                    </GatedSplitAction>
                    <button
                      type="button"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                      onClick={() => void onReuseTemplate(id)}
                    >
                      {reuseOrManuscriptLabel}
                    </button>
                    <div className="relative" ref={menuOpenId === id ? menuWrapRef : undefined}>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
                        aria-label="更多"
                        onClick={() => setMenuOpenId((x) => (x === id ? null : id))}
                      >
                        <span className="text-base leading-none">⋯</span>
                      </button>
                    </div>
                    {publications.length > 0 ? (
                      <span className="ml-auto rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success-ink">{publishedText}</span>
                    ) : null}
                  </div>
                </li>
              );
            }

            return (
              <li
                key={id}
                className="relative flex w-full max-w-full flex-col overflow-visible rounded-xl border border-line bg-surface shadow-soft"
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
                {isScriptDraft ? (
                  <div className="overflow-hidden rounded-t-xl border-b border-success/25 bg-gradient-to-br from-success-soft/95 to-success/[0.08] px-3 py-2">
                    <div className="flex gap-2">
                      <span className="shrink-0 text-base leading-none" aria-hidden>
                        📝
                      </span>
                      <div className="min-w-0 flex-1 space-y-1 text-[11px] leading-snug text-success-ink/85">
                        <ScriptWorkSourceSummary w={w} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-gradient-to-br from-fill to-fill">
                    {w.coverImage ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={coverImageSrc(w.coverImage, coverBustById[id])}
                        alt=""
                        className="relative z-[1] h-full w-full object-cover"
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
                    ) : (
                      <div className="flex h-full min-h-[3rem] items-center justify-center text-[10px] text-muted">无配图</div>
                    )}
                  </div>
                )}

                <div className="flex min-h-[4.25rem] shrink-0 flex-row items-center gap-2 border-t border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-tight text-ink" title={w.displayTitle}>
                      {w.displayTitle}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted" title={durationCaption}>
                      {durationCaption}
                    </p>
                    {scriptCharCountDisplay !== null ? (
                      <p
                        className="mt-0.5 truncate text-[11px] tabular-nums text-muted"
                        title={`正文约 ${scriptCharCountDisplay.toLocaleString()} 字`}
                      >
                        约 {scriptCharCountDisplay.toLocaleString()} 字
                      </p>
                    ) : null}
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
                        onClick={() => void togglePlay(id, w.displayTitle)}
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
                {rowPlayMsg ? (
                  <p
                    className="border-t border-danger/25 bg-danger-soft/90 px-2 py-0.5 text-[9px] leading-tight text-danger-ink"
                    role="status"
                  >
                    {rowPlayMsg}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-fill/30 px-2 py-1.5 text-[11px]">
                  {!isScriptDraft ? (
                    <button
                      type="button"
                      className="rounded-md border border-line bg-surface px-2 py-1 font-medium text-ink hover:bg-fill disabled:opacity-50"
                      disabled={audioLoadingId === id}
                      onClick={() => void togglePlay(id, w.displayTitle)}
                    >
                      {isActive && isPlayingAudio ? "暂停" : "播放"}
                    </button>
                  ) : null}
                  {!isScriptDraft ? (
                    <button
                      type="button"
                      className="rounded-md border border-brand/45 bg-brand/10 px-2 py-1 font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
                      onClick={() => goToSharePage(w)}
                    >
                      {publishActionText}
                    </button>
                  ) : null}
                  <GatedSplitAction
                    locked={!workDownloadAllowed(w)}
                    variant="default"
                    upgradeTitle="下载需订阅"
                    onClick={() => void onDownload(w)}
                    disabled={zipBusy === id}
                    unlockedClassName="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill disabled:pointer-events-none disabled:opacity-40"
                  >
                    {zipBusy === id ? downloadBusyLabel(w.type) : "下载"}
                  </GatedSplitAction>
                  <button
                    type="button"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-fill"
                    onClick={() => void onReuseTemplate(id)}
                  >
                    {reuseOrManuscriptLabel}
                  </button>
                  {publications.length > 0 ? (
                    <span className="ml-auto rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success-ink">{publishedText}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {variant === "notes_studio" && notesStudioMenuPortalData && notesStudioMenuPos
          ? createPortal(
              (() => {
                const m = notesStudioMenuPortalData;
                const pos = notesStudioMenuPos;
                return (
                  <div
                    ref={notesStudioMenuPortalRef}
                    role="menu"
                    className="fixed z-[1210] min-w-[9.5rem] max-h-[min(280px,calc(100vh-16px))] overflow-y-auto rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                    style={{ top: pos.top, left: pos.left }}
                  >
                    <GatedSplitAction
                      locked={!workDownloadAllowed(m.w)}
                      variant="default"
                      upgradeTitle="下载需订阅"
                      onClick={() => {
                        setMenuOpenId(null);
                        void onDownload(m.w);
                      }}
                      disabled={zipBusy === m.id}
                      unlockedClassName="block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-40"
                      lockedLinkClassName="w-full max-w-none rounded-none border-0 border-b border-line/80 bg-transparent shadow-none"
                      lockedLabelClassName="px-3 py-2"
                      onLockedNavigate={() => setMenuOpenId(null)}
                    >
                      {zipBusy === m.id ? downloadBusyLabel(m.w.type) : downloadLabelForWorkType(m.w.type)}
                    </GatedSplitAction>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left hover:bg-fill"
                      onClick={() => {
                        setMenuOpenId(null);
                        openRename(m.id, m.w.displayTitle);
                      }}
                    >
                      修改名称
                    </button>
                    {!m.isScriptDraft ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left hover:bg-fill"
                        onClick={() => {
                          setMenuOpenId(null);
                          goToSharePage(m.w);
                        }}
                      >
                        {m.publishActionText}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-danger-ink hover:bg-danger-soft"
                      onClick={() => {
                        setMenuOpenId(null);
                        requestDelete(m.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                );
              })(),
              document.body
            )
          : null}
        {worksGridMenuPortalData && notesStudioMenuPos
          ? createPortal(
              (() => {
                const spec = worksGridMenuPortalData;
                const pos = notesStudioMenuPos;
                if (spec.layout === "toolbar") {
                  const { w, id, isScriptDraft } = spec;
                  return (
                    <div
                      ref={notesStudioMenuPortalRef}
                      role="menu"
                      className="fixed z-[1210] min-w-[9.5rem] max-h-[min(280px,calc(100vh-16px))] overflow-y-auto rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                      style={{ top: pos.top, left: pos.left }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left hover:bg-fill"
                        onClick={() => {
                          setMenuOpenId(null);
                          openRename(id, w.displayTitle);
                        }}
                      >
                        修改名称
                      </button>
                      {!isScriptDraft ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-50"
                          disabled={coverUploadBusy === id}
                          onClick={() => {
                            setMenuOpenId(null);
                            coverUploadTargetIdRef.current = id;
                            coverFileInputRef.current?.click();
                          }}
                        >
                          {coverUploadBusy === id ? "处理封面中…" : "上传封面（裁 1400²）"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-danger-ink hover:bg-danger-soft"
                        onClick={() => {
                          setMenuOpenId(null);
                          requestDelete(id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  );
                }
                const { w, id, isScriptDraft, publishActionText } = spec;
                return (
                  <div
                    ref={notesStudioMenuPortalRef}
                    role="menu"
                    className="fixed z-[1210] min-w-[9.5rem] max-h-[min(280px,calc(100vh-16px))] overflow-y-auto rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                    style={{ top: pos.top, left: pos.left }}
                  >
                    <GatedSplitAction
                      locked={!workDownloadAllowed(w)}
                      variant="default"
                      upgradeTitle="下载需订阅"
                      onClick={() => {
                        setMenuOpenId(null);
                        void onDownload(w);
                      }}
                      disabled={zipBusy === id}
                      unlockedClassName="block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-40"
                      lockedLinkClassName="w-full max-w-none rounded-none border-0 border-b border-line/80 bg-transparent shadow-none"
                      lockedLabelClassName="px-3 py-2"
                      onLockedNavigate={() => setMenuOpenId(null)}
                    >
                      {zipBusy === id ? downloadBusyLabel(w.type) : downloadLabelForWorkType(w.type)}
                    </GatedSplitAction>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left hover:bg-fill"
                      onClick={() => {
                        setMenuOpenId(null);
                        openRename(id, w.displayTitle);
                      }}
                    >
                      修改名称
                    </button>
                    {!isScriptDraft ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-50"
                        disabled={coverUploadBusy === id}
                        onClick={() => {
                          setMenuOpenId(null);
                          coverUploadTargetIdRef.current = id;
                          coverFileInputRef.current?.click();
                        }}
                      >
                        {coverUploadBusy === id ? "处理封面中…" : "上传封面（裁 1400²）"}
                      </button>
                    ) : null}
                    {!isScriptDraft ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left hover:bg-fill"
                        onClick={() => {
                          setMenuOpenId(null);
                          goToSharePage(w);
                        }}
                      >
                        {publishActionText}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-danger-ink hover:bg-danger-soft"
                      onClick={() => {
                        setMenuOpenId(null);
                        requestDelete(id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                );
              })(),
              document.body
            )
          : null}
        {sidebarMoreCount > 0 ? (
          <div className="mt-3 flex justify-center">
            <Link
              href="/works"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5"
            >
              更多作品
              <span className="tabular-nums text-muted">+{sidebarMoreCount}</span>
            </Link>
          </div>
        ) : null}
        </>
      )}
    </div>
  );
}
