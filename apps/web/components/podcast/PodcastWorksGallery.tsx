"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import { hexToMp3DataUrl } from "../../lib/audioHex";
import { unusableInsecureHttpOnHttpsPage } from "../../lib/insecureHttpOnHttpsPage";
import { useAuth, userAccountRef } from "../../lib/auth";
import { scheduleCloudPreferencesPush } from "../../lib/cloudPreferences";
import { blobToDataUrlBase64, cropSquareToPodcastCoverJpeg } from "../../lib/podcastCoverImage";
import { sanitizeShareEpisodeTitle } from "../../lib/sharePublishDefaults";
import { downloadJobBundleZip, downloadJobManuscriptTxt } from "../../lib/workBundleDownload";
import {
  isWorkDownloadRechargeGateError,
  openSubscriptionWalletTopup,
  WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE
} from "../../lib/workDownloadRechargeGate";
import { listRssPublicationsByJobIds, type RssPublication, cancelJob } from "../../lib/api";
import type { WorkItem } from "../../lib/worksTypes";
import { isTextOnlyWorkType } from "../../lib/worksTypes";
import { useI18n } from "../../lib/I18nContext";
import { resolveJobScriptBodyText } from "../../lib/jobScriptText";
import { copyWorkManuscriptToClipboard } from "../../lib/copyWorkManuscript";
import { insertPodcastDraftAtTop, setDraftsNavigationFocusDraftId } from "../../lib/podcastDrafts";
import { readLocalStorageScoped, writeLocalStorageScoped, writeSessionStorageScoped } from "../../lib/userScopedStorage";
import { useAppNotice } from "../../lib/AppNoticeContext";
import UserErrorBanner from "../ui/UserErrorBanner";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";
import { workCoverImageSrc } from "../../lib/workCoverImage";
import {
  WorkGalleryListProvider,
  type WorkGalleryListContextValue,
  type WorkGalleryRowLayout
} from "./workGalleryListContext";
import { WorkGalleryListItem } from "./WorkGalleryListItem";
import { WorkGalleryVirtualGrid } from "./WorkGalleryVirtualGrid";
import { useWorkGalleryGridColumnCount } from "./useWorkGalleryGridColumnCount";
import { buildWorkDetailHref } from "./workGalleryNav";
import {
  humanNoteSourceLabel,
  isPodcastManuscriptDraftTarget,
  type PodcastWorkRow,
  workGalleryRowMutationsLocked,
  workIsPodcastTemplateNonOwner
} from "./workGalleryListShared";

function workDownloadAllowed(w: Pick<WorkItem, "downloadAllowed">): boolean {
  return w.downloadAllowed === true;
}

/** 与编排器 downloadAllowed / 未充值下载拦截提示一致（宜简短） */
const WORK_DOWNLOAD_GATE_TIP = "需有充值记录方可下载";

const PODCAST_TYPES = new Set(["podcast_generate", "podcast", "podcast_short_video"]);
const TTS_TYPES = new Set(["text_to_speech", "tts"]);
/** 笔记本出稿（script_draft / 自媒体发布稿） */
const NOTES_WORK_TYPES = new Set(["script_draft", "social_publish_draft"]);
/** 笔记本页：成片 + 文章出稿 + 自媒体发布稿 */
const NOTES_STUDIO_TYPES = new Set(["podcast_generate", "podcast", "script_draft", "social_publish_draft"]);

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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  /** 笔记本工作台侧栏：进行中的任务（尚未出现在成功作品列表中） */
  pendingStudioWork?: WorkItem | null;
  /** 与 pending 卡片配套的进度文案（SSE / 排队提示） */
  pendingStudioSubtitle?: string;
  /**
   * variant=all：与笔记本侧栏「我的作品」相同的紧凑单列卡片（无封面大图条）。
   * 用于嵌入窄栏且需与侧栏列表一致的展示。
   */
  compactCards?: boolean;
  /** 进入作品详情时写入 `?returnTo=`，供返回上一级页面 */
  workDetailReturnTo?: string;
  /** 无成片时在空状态文案下追加 CTA（如创作页引导去知识库） */
  emptyStateFooter?: ReactNode;
  /** 「进行中」列表：卡片底部用停止/删除替换下载/修改文稿 */
  activeQueueCardActions?: boolean;
  /** notes_studio 侧栏「更多作品」链接；默认 /works?tab=audio */
  viewAllHref?: string;
};

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
  return "引用参考资料未记录";
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
  sidebarMaxItems,
  pendingStudioWork = null,
  pendingStudioSubtitle = "",
  compactCards = false,
  workDetailReturnTo,
  emptyStateFooter,
  activeQueueCardActions = false,
  viewAllHref
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const { getAuthHeaders, user } = useAuth();
  const viewerAccountRefStr = useMemo(() => userAccountRef(user), [user]);
  const workDownloadExtraLocked = useCallback(
    (row: PodcastWorkRow) => workIsPodcastTemplateNonOwner(row, viewerAccountRefStr),
    [viewerAccountRefStr]
  );
  const workAudio = useWorkAudioPlayer();
  const { showError, showInfo } = useAppNotice();

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
  const useCompactAllLayout = variant === "all" && compactCards;
  const useNotesStyleCards = variant === "notes_studio" || useCompactAllLayout;
  const rowLayout = useMemo((): WorkGalleryRowLayout => {
    if (activeQueueCardActions) return "active";
    if (variant === "notes") return "script-list";
    if (variant === "notes_studio" || useCompactAllLayout) return "compact";
    return "grid";
  }, [activeQueueCardActions, variant, useCompactAllLayout]);
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
  const [stopBusyId, setStopBusyId] = useState<string | null>(null);
  const [copyManuscriptBusyId, setCopyManuscriptBusyId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [publicationsByJobId, setPublicationsByJobId] = useState<Record<string, RssPublication[]>>({});

  const [coverBustById, setCoverBustById] = useState<Record<string, number>>({});
  const [coverUploadBusy, setCoverUploadBusy] = useState<string | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const coverUploadTargetIdRef = useRef<string | null>(null);
  const prewarmedCoverSrcRef = useRef<Set<string>>(new Set());

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
    (jobId: string, displayTitle: string, audioOpts?: { usePodcastPublicTemplateListen?: boolean }) => {
      setPlayErrorById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      void toggleWorkAudio(jobId, {
        displayTitle,
        usePodcastPublicTemplateListen: audioOpts?.usePodcastPublicTemplateListen
      });
    },
    [toggleWorkAudio]
  );
  const [hydratedDurationSec, setHydratedDurationSec] = useState<Record<string, number>>({});
  const durationFetchRef = useRef<Set<string>>(new Set());
  const durationResolvedRef = useRef<Set<string>>(new Set());
  const [playErrorById, setPlayErrorById] = useState<Record<string, string>>({});
  const [downloadRechargeModalOpen, setDownloadRechargeModalOpen] = useState(false);

  const items = useMemo((): PodcastWorkRow[] => {
    const list = works.filter((w) => {
      const wid = String(w.id || "").trim();
      if (!wid) return false;
      if (hidden.has(wid)) return false;
      if (allowedTypes === null) return true;
      return allowedTypes.has(String(w.type || ""));
    });
    const mapped = list.map((w) => ({
      ...w,
      displayTitle:
        (w.id && titleOverrides[w.id]) ||
        sanitizeShareEpisodeTitle(String(w.title || ""), "") ||
        String(w.title || "").trim() ||
        w.id ||
        "未命名"
    }));
    const pendingId =
      variant === "notes_studio" && pendingStudioWork?.id ? String(pendingStudioWork.id).trim() : "";
    const withoutDup = pendingId ? mapped.filter((w) => String(w.id || "") !== pendingId) : mapped;
    if (!pendingId || !pendingStudioWork) return withoutDup;
    const baseRow: PodcastWorkRow = {
      ...pendingStudioWork,
      id: pendingId,
      displayTitle: ""
    };
    baseRow.displayTitle =
      (pendingId && titleOverrides[pendingId]) ||
      sanitizeShareEpisodeTitle(String(pendingStudioWork.title || "").trim(), "") ||
      notesStudioReferencedWorkTitle(baseRow) ||
      pendingId ||
      "生成中";
    return [baseRow, ...withoutDup];
  }, [works, hidden, titleOverrides, allowedTypes, variant, pendingStudioWork]);

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

  const gridColumnCount = useWorkGalleryGridColumnCount();
  const [clientMounted, setClientMounted] = useState(false);
  useEffect(() => setClientMounted(true), []);
  const useGridVirtual = clientMounted && rowLayout === "grid" && visibleItems.length >= 12;
  const eagerCoverFirstCount = useGridVirtual ? gridColumnCount : 4;
  const useListCoverThumbs = rowLayout === "grid";

  useEffect(() => {
    const firstN = visibleItems.slice(0, eagerCoverFirstCount);
    for (const w of firstN) {
      const id = String(w.id || "").trim();
      if (!id || !String(w.coverImage || "").trim()) continue;
      const src = workCoverImageSrc(
        w.coverImage,
        coverBustById[id],
        id,
        useListCoverThumbs ? { listMaxWidth: 400 } : undefined
      );
      if (!src || prewarmedCoverSrcRef.current.has(src)) continue;
      prewarmedCoverSrcRef.current.add(src);
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [visibleItems, coverBustById, eagerCoverFirstCount, useListCoverThumbs]);

  useEffect(() => {
    const ids = items
      .map((x) => String(x.id || "").trim())
      .filter(Boolean);
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
    if (!menuOpenId) return null;
    const menuLikeNotesStudio = variant === "notes_studio" || (variant === "all" && compactCards);
    if (!menuLikeNotesStudio) return null;
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
  }, [variant, compactCards, menuOpenId, items, publicationsByJobId]);

  /** 我的作品 / 首页合并列表：⋯ 菜单用 portal，避免卡片 overflow 裁切与网格叠层遮挡 */
  const worksGridMenuPortalData = useMemo(() => {
    if (!menuOpenId || variant === "notes_studio" || (variant === "all" && compactCards)) return null;
    const w = items.find((x) => x.id === menuOpenId);
    if (!w?.id) return null;
    const id = w.id;
    const isScriptDraft = String(w.type || "") === "script_draft";
    const pubs = publicationsByJobId[id] || [];
    const publishActionText = pubs.length > 0 ? "已发过" : "分享";
    if (variant === "all") {
      if (isTextOnlyWorkType(String(w.type || ""))) {
        return { layout: "script-card" as const, w, id };
      }
      return { layout: "toolbar" as const, w, id, isScriptDraft };
    }
    if (variant === "notes") {
      return { layout: "script-card" as const, w, id };
    }
    return { layout: "card" as const, w, id, isScriptDraft, publishActionText };
  }, [variant, compactCards, menuOpenId, items, publicationsByJobId]);

  useEffect(() => {
    for (const w of items) {
      const id = w.id;
      if (!id) continue;
      const st = String(w.status || "").trim();
      if (st === "queued" || st === "running") {
        durationResolvedRef.current.add(id);
        continue;
      }
      if (w.isPodcastPublicTemplate) {
        durationResolvedRef.current.add(id);
        continue;
      }
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
          if (!hex && audioUrl && unusableInsecureHttpOnHttpsPage(audioUrl)) {
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
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (t instanceof Element && t.closest("[data-fym-app-sidebar]")) {
        setMenuOpenId(null);
        return;
      }
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
      if (
        String(row.type || "") === "script_draft" ||
        String(row.type || "") === "social_publish_draft"
      ) {
        await downloadJobManuscriptTxt({ jobId: id, title });
      } else {
        await downloadJobBundleZip({ jobId: id, title });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isWorkDownloadRechargeGateError(message)) {
        setDownloadRechargeModalOpen(true);
      } else {
        setPlayErrorById((prev) => ({
          ...prev,
          [id]: `下载失败：${message}（任务 ID：${id}）`
        }));
      }
    } finally {
      setZipBusy(null);
    }
  }, []);

  const requestStopActiveJob = useCallback(
    async (jobId: string) => {
      setStopBusyId(jobId);
      setPlayErrorById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      try {
        await cancelJob(jobId);
        onWorkDeleted?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPlayErrorById((prev) => ({ ...prev, [jobId]: `停止失败：${msg}` }));
      } finally {
        setStopBusyId(null);
      }
    },
    [onWorkDeleted]
  );

  const requestCopyManuscript = useCallback(
    async (jobId: string, work?: Pick<WorkItem, "scriptText" | "scriptCharCount" | "status">) => {
      if (copyManuscriptBusyId) return;
      setCopyManuscriptBusyId(jobId);
      try {
        await copyWorkManuscriptToClipboard(jobId, { authHeaders: getAuthHeaders(), work });
        showInfo("已复制到剪贴板");
      } catch (e) {
        showError(e instanceof Error ? e.message : "复制失败，请检查浏览器是否允许本站访问剪贴板。");
      } finally {
        setCopyManuscriptBusyId(null);
      }
    },
    [copyManuscriptBusyId, getAuthHeaders, showError, showInfo]
  );

  const renderDownloadGated = useCallback(
    (
      row: PodcastWorkRow,
      jobId: string,
      unlockedClassName: string,
      label: ReactNode,
      gatedExtras?: {
        lockedLinkClassName?: string;
        lockedLabelClassName?: string;
        onLockedNavigate?: () => void;
      }
    ) => {
      const allowed = workDownloadAllowed(row) && !workDownloadExtraLocked(row);
      const busy = zipBusy === jobId;
      const menuItem = Boolean(gatedExtras?.onLockedNavigate);
      if (allowed) {
        return (
          <button
            type="button"
            className={unlockedClassName}
            disabled={busy}
            role={menuItem ? "menuitem" : undefined}
            onClick={() => {
              gatedExtras?.onLockedNavigate?.();
              void onDownload(row);
            }}
          >
            {label}
          </button>
        );
      }
      const deniedCls = [unlockedClassName, gatedExtras?.lockedLinkClassName, gatedExtras?.lockedLabelClassName]
        .filter(Boolean)
        .join(" ");
      return (
        <button
          type="button"
          className={deniedCls}
          disabled
          role={menuItem ? "menuitem" : undefined}
          title={workDownloadExtraLocked(row) ? "模板作品仅创建者可下载" : WORK_DOWNLOAD_GATE_TIP}
          aria-label={workDownloadExtraLocked(row) ? "模板作品仅创建者可下载" : WORK_DOWNLOAD_GATE_TIP}
        >
          {label}
        </button>
      );
    },
    [onDownload, zipBusy, workDownloadExtraLocked]
  );

  function downloadBusyLabel(workType: string | undefined): string {
    const t = String(workType || "");
    return t === "script_draft" || t === "social_publish_draft" ? "正在下载…" : "正在打包…";
  }

  function downloadLabelForWorkType(type: string | undefined): string {
    const t = String(type || "");
    if (t === "script_draft" || t === "social_publish_draft") return "下载 TXT 文稿";
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
    if (works.some((w) => String(w.id || "") === jobId && workGalleryRowMutationsLocked(w, viewerAccountRefStr))) return;
    setRenameJobId(jobId);
    setRenameDraft(current);
    setMenuOpenId(null);
    setDeleteConfirmId(null);
  }, [works, viewerAccountRefStr]);

  const confirmDelete = useCallback(
    async (jobId: string) => {
      if (works.some((w) => String(w.id || "") === jobId && workGalleryRowMutationsLocked(w, viewerAccountRefStr))) {
        setDeleteConfirmId(null);
        return;
      }
      setDeleteBusyId(jobId);
      setDeleteError(null);
      const row = works.find((w) => String(w.id || "") === jobId);
      const jst = String(row?.status || "").trim();
      if (jst === "queued" || jst === "running") {
        try {
          await cancelJob(jobId);
        } catch {
          /* 仍尝试 purge，与旧「进行中」面板先停后删一致 */
        }
      }
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
    [dismissIfJob, clearCachedAudioSrc, onWorkDeleted, titlesKey, hiddenKey, getAuthHeaders, works, viewerAccountRefStr]
  );

  const requestDelete = useCallback((jobId: string) => {
    if (works.some((w) => String(w.id || "") === jobId && workGalleryRowMutationsLocked(w, viewerAccountRefStr))) return;
    setDeleteConfirmId(jobId);
    setDeleteError(null);
    setMenuOpenId(null);
    setRenameJobId(null);
  }, [works, viewerAccountRefStr]);

  const pendingDeleteTitle =
    deleteConfirmId != null ? items.find((x) => x.id === deleteConfirmId)?.displayTitle || deleteConfirmId : "";
  const pendingDeleteRow =
    deleteConfirmId != null ? items.find((x) => String(x.id) === String(deleteConfirmId)) : undefined;
  const deleteTargetInflight =
    Boolean(pendingDeleteRow) &&
    (String(pendingDeleteRow?.status || "") === "queued" || String(pendingDeleteRow?.status || "") === "running");
  const deleteModalMessage = deleteTargetInflight
    ? `确定删除「${pendingDeleteTitle}」吗？任务进行中，删除将停止并永久移除，不可恢复。`
    : `确定删除「${pendingDeleteTitle}」吗？将从服务器彻底移除该作品，不可恢复；本机显示名称缓存会清除。`;

  const selectedCount = selectedIds.size;
  const selectedRows = items.filter((x) => x.id && selectedIds.has(x.id));
  const batchAllSelectedAllowDownload =
    selectedRows.length > 0 && selectedRows.every((w) => workDownloadAllowed(w));

  const goToSharePage = useCallback(
    (work: PodcastWorkRow) => {
      const id = String(work.id || "").trim();
      if (!id) return;
      if (workIsPodcastTemplateNonOwner(work, viewerAccountRefStr)) return;
      setMenuOpenId(null);
      try {
        writeSessionStorageScoped(`fym_share_display_title:${id}`, work.displayTitle);
      } catch {
        /* ignore */
      }
      router.push(buildWorkDetailHref(id, { returnTo: workDetailReturnTo, tabPublish: true }));
    },
    [router, workDetailReturnTo, viewerAccountRefStr]
  );

  async function uploadCoverForJob(jobId: string, file: File) {
    if (works.some((w) => String(w.id || "") === jobId && workGalleryRowMutationsLocked(w, viewerAccountRefStr))) {
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showError("封面图片需不超过 8MB");
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
      showError(e instanceof Error ? e.message : "封面上传失败");
    } finally {
      setCoverUploadBusy(null);
      coverUploadTargetIdRef.current = null;
    }
  }

  const onReuseTemplate = useCallback(
    async (id: string, opts?: { publicTemplate?: boolean }) => {
      try {
        const usePublicTpl = Boolean(opts?.publicTemplate);
        const res = await fetch(
          usePublicTpl
            ? `/api/jobs/${encodeURIComponent(id)}/podcast-template-reuse`
            : `/api/jobs/${encodeURIComponent(id)}`,
          { cache: "no-store", headers: { ...getAuthHeaders() } }
        );
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
            showError("暂无文稿可复制");
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
    },
    [getAuthHeaders, router, showError]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function batchDownloadSelected() {
    if (selectedRows.length === 0) return;
    const rows = selectedRows.filter((w) => workDownloadAllowed(w));
    if (rows.length === 0) return;
    setBatchBusy(true);
    try {
      for (const row of rows) {
        if (!row.id) continue;
        const title = row.displayTitle || row.title || row.id;
        const id = row.id;
        try {
          if (
            String(row.type || "") === "script_draft" ||
            String(row.type || "") === "social_publish_draft"
          ) {
            await downloadJobManuscriptTxt({ jobId: id, title });
          } else {
            await downloadJobBundleZip({ jobId: id, title });
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (isWorkDownloadRechargeGateError(message)) {
            setDownloadRechargeModalOpen(true);
          } else {
            setPlayErrorById((prev) => ({
              ...prev,
              [id]: `下载失败：${message}（任务 ID：${id}）`
            }));
          }
          break;
        }
      }
    } finally {
      setBatchBusy(false);
    }
  }

  const sidebarViewAllHref = useMemo(() => {
    if (viewAllHref?.trim()) return viewAllHref.trim();
    const q = new URLSearchParams({ tab: "audio" });
    if (workDetailReturnTo?.trim()) q.set("returnTo", workDetailReturnTo.trim());
    return `/works?${q.toString()}`;
  }, [viewAllHref, workDetailReturnTo]);

  const listCtxValue = useMemo<WorkGalleryListContextValue>(
    () => ({
      variant,
      rowLayout,
      useNotesStyleCards,
      useCompactAllLayout,
      enableBatchActions: Boolean(enableBatchActions),
      batchMode,
      selectedIds,
      toggleSelect,
      pendingStudioWork: pendingStudioWork ?? null,
      pendingStudioSubtitle: pendingStudioSubtitle || "",
      activeJobId,
      isPlayingAudio,
      activePlayError,
      playErrorById,
      progress01,
      durationSec,
      hydratedDurationSec,
      publicationsByJobId,
      menuOpenId,
      setMenuOpenId,
      menuWrapRef,
      renameJobId,
      renameDraft,
      setRenameDraft,
      commitRename,
      setRenameJobId,
      coverBustById,
      audioLoadingId,
      togglePlay,
      worksNavAuthorDisplay,
      workDetailReturnTo,
      goToSharePage,
      zipBusy,
      openRename,
      requestDelete,
      onReuseTemplate,
      renderDownloadGated,
      viewerAccountRef: viewerAccountRefStr,
      activeQueueCardActions,
      stopBusyId,
      requestStopActiveJob,
      copyManuscriptBusyId,
      requestCopyManuscript
    }),
    [
      variant,
      rowLayout,
      useNotesStyleCards,
      useCompactAllLayout,
      enableBatchActions,
      batchMode,
      selectedIds,
      pendingStudioWork,
      pendingStudioSubtitle,
      activeJobId,
      isPlayingAudio,
      activePlayError,
      playErrorById,
      progress01,
      durationSec,
      hydratedDurationSec,
      publicationsByJobId,
      menuOpenId,
      renameJobId,
      renameDraft,
      coverBustById,
      audioLoadingId,
      worksNavAuthorDisplay,
      workDetailReturnTo,
      goToSharePage,
      zipBusy,
      openRename,
      requestDelete,
      renderDownloadGated,
      commitRename,
      toggleSelect,
      onReuseTemplate,
      togglePlay,
      viewerAccountRefStr,
      activeQueueCardActions,
      stopBusyId,
      requestStopActiveJob,
      copyManuscriptBusyId,
      requestCopyManuscript
    ]
  );

  return (
    <WorkGalleryListProvider value={listCtxValue}>
    <div>
      <SmallConfirmModal
        open={downloadRechargeModalOpen}
        title="无法下载"
        message={WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE}
        cancelLabel="关闭"
        confirmLabel="充值"
        onCancel={() => setDownloadRechargeModalOpen(false)}
        onConfirm={() => {
          setDownloadRechargeModalOpen(false);
          openSubscriptionWalletTopup();
        }}
      />
      <SmallConfirmModal
        open={deleteConfirmId != null}
        title="删除作品"
        message={deleteModalMessage}
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
        <UserErrorBanner className="mb-2" message={fetchError} onDismiss={onDismissError} />
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
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2.5 py-1 text-ink opacity-50 cursor-not-allowed"
                  disabled
                  title={WORK_DOWNLOAD_GATE_TIP}
                  aria-label={WORK_DOWNLOAD_GATE_TIP}
                >
                  {batchBusy ? "正在批量下载…" : "批量下载"}
                </button>
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
        <div className="fym-empty-state py-10 text-center text-sm text-muted" aria-busy>
          <p>{t("gallery.loading")}</p>
          <div className="mx-auto mt-4 h-24 max-w-md animate-pulse rounded-xl border border-line/60 bg-fill/50" />
        </div>
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
          {emptyStateFooter ? <div className="mt-5 text-center">{emptyStateFooter}</div> : null}
        </div>
      ) : (
        <>
        {rowLayout === "script-list" ? (
          <ul className="grid w-full grid-cols-2 gap-2 overflow-visible">
            {visibleItems.map((w, index) => (
              <WorkGalleryListItem
                key={String(w.id)}
                w={w}
                index={index}
                outer="li"
                eagerCoverFirstCount={eagerCoverFirstCount}
                useListCoverThumb={useListCoverThumbs}
              />
            ))}
          </ul>
        ) : rowLayout !== "grid" ? (
          <ul className="grid w-full grid-cols-1 gap-2 overflow-visible">
            {visibleItems.map((w, index) => (
              <WorkGalleryListItem
                key={String(w.id)}
                w={w}
                index={index}
                outer="li"
                eagerCoverFirstCount={eagerCoverFirstCount}
                useListCoverThumb={useListCoverThumbs}
              />
            ))}
          </ul>
        ) : useGridVirtual ? (
          <div className="w-full" role="list">
            <WorkGalleryVirtualGrid
              items={visibleItems}
              columnCount={gridColumnCount}
              variant={variant}
              eagerCoverFirstCount={eagerCoverFirstCount}
            />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleItems.map((w, index) => (
              <WorkGalleryListItem
                key={String(w.id)}
                w={w}
                index={index}
                outer="li"
                eagerCoverFirstCount={eagerCoverFirstCount}
                useListCoverThumb={useListCoverThumbs}
              />
            ))}
          </ul>
        )}

        {rowLayout !== "grid" && notesStudioMenuPortalData && notesStudioMenuPos
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
                    {renderDownloadGated(
                      m.w,
                      m.id,
                      "block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-40",
                      zipBusy === m.id ? downloadBusyLabel(m.w.type) : downloadLabelForWorkType(m.w.type),
                      {
                        lockedLinkClassName:
                          "w-full max-w-none rounded-none border-0 border-b border-line/80 bg-transparent shadow-none",
                        lockedLabelClassName: "px-3 py-2",
                        onLockedNavigate: () => setMenuOpenId(null)
                      }
                    )}
                    {!workGalleryRowMutationsLocked(m.w, viewerAccountRefStr) ? (
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
                    ) : null}
                    {!m.isScriptDraft ? (
                      <button
                        type="button"
                        role="menuitem"
                        className={`block w-full px-3 py-2 text-left hover:bg-fill disabled:pointer-events-none disabled:opacity-40`}
                        disabled={workIsPodcastTemplateNonOwner(m.w, viewerAccountRefStr)}
                        title={
                          workIsPodcastTemplateNonOwner(m.w, viewerAccountRefStr)
                            ? "模板作品仅创建者可分享发布"
                            : undefined
                        }
                        onClick={() => {
                          setMenuOpenId(null);
                          goToSharePage(m.w);
                        }}
                      >
                        {m.publishActionText}
                      </button>
                    ) : null}
                    {!workGalleryRowMutationsLocked(m.w, viewerAccountRefStr) ? (
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
                    ) : null}
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
                if (spec.layout === "script-card") {
                  const { w, id } = spec;
                  const rowLocked = workGalleryRowMutationsLocked(w, viewerAccountRefStr);
                  return (
                    <div
                      ref={notesStudioMenuPortalRef}
                      role="menu"
                      className="fixed z-[1210] min-w-[8.5rem] overflow-hidden rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                      style={{ top: pos.top, left: pos.left }}
                    >
                      {!rowLocked ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2 text-left hover:bg-fill"
                          onClick={() => {
                            setMenuOpenId(null);
                            openRename(id, w.displayTitle);
                          }}
                        >
                          改名
                        </button>
                      ) : null}
                      {!rowLocked ? (
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
                      ) : null}
                    </div>
                  );
                }
                if (spec.layout === "toolbar") {
                  const { w, id, isScriptDraft } = spec;
                  const rowLocked = workGalleryRowMutationsLocked(w, viewerAccountRefStr);
                  return (
                    <div
                      ref={notesStudioMenuPortalRef}
                      role="menu"
                      className="fixed z-[1210] min-w-[9.5rem] max-h-[min(280px,calc(100vh-16px))] overflow-y-auto rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                      style={{ top: pos.top, left: pos.left }}
                    >
                      {!rowLocked ? (
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
                      ) : null}
                      {!isScriptDraft && !rowLocked ? (
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
                      {!rowLocked ? (
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
                      ) : null}
                    </div>
                  );
                }
                const { w, id, isScriptDraft, publishActionText } = spec;
                const rowLocked = workGalleryRowMutationsLocked(w, viewerAccountRefStr);
                return (
                  <div
                    ref={notesStudioMenuPortalRef}
                    role="menu"
                    className="fixed z-[1210] min-w-[9.5rem] max-h-[min(280px,calc(100vh-16px))] overflow-y-auto rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
                    style={{ top: pos.top, left: pos.left }}
                  >
                    {renderDownloadGated(
                      w,
                      id,
                      "block w-full px-3 py-2 text-left hover:bg-fill disabled:opacity-40",
                      zipBusy === id ? downloadBusyLabel(w.type) : downloadLabelForWorkType(w.type),
                      {
                        lockedLinkClassName:
                          "w-full max-w-none rounded-none border-0 border-b border-line/80 bg-transparent shadow-none",
                        lockedLabelClassName: "px-3 py-2",
                        onLockedNavigate: () => setMenuOpenId(null)
                      }
                    )}
                    {!rowLocked ? (
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
                    ) : null}
                    {!isScriptDraft && !rowLocked ? (
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
                        className="block w-full px-3 py-2 text-left hover:bg-fill disabled:pointer-events-none disabled:opacity-40"
                        disabled={workIsPodcastTemplateNonOwner(w, viewerAccountRefStr)}
                        title={
                          workIsPodcastTemplateNonOwner(w, viewerAccountRefStr)
                            ? "模板作品仅创建者可分享发布"
                            : undefined
                        }
                        onClick={() => {
                          setMenuOpenId(null);
                          goToSharePage(w);
                        }}
                      >
                        {publishActionText}
                      </button>
                    ) : null}
                    {!rowLocked ? (
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
                    ) : null}
                  </div>
                );
              })(),
              document.body
            )
          : null}
        {sidebarMoreCount > 0 ? (
          <div className="mt-3 flex justify-center">
            <Link
              href={sidebarViewAllHref}
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
    </WorkGalleryListProvider>
  );
}
