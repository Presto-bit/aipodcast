"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InlineConfirmBar from "../../components/ui/InlineConfirmBar";
import InlineTextPrompt from "../../components/ui/InlineTextPrompt";
import SmallPromptModal from "../../components/ui/SmallPromptModal";
import EmptyState from "../../components/ui/EmptyState";
import NoteMarkdownPreview from "../../components/notes/NoteMarkdownPreview";
import NotesPodcastRoomModal from "../../components/notes/NotesPodcastRoomModal";
import PodcastWorksGallery from "../../components/podcast/PodcastWorksGallery";
import { createJob, cancelJob } from "../../lib/api";
import { apiErrorMessage } from "../../lib/apiError";
import { clearActiveGenerationJob, readActiveGenerationJob, setActiveGenerationJob } from "../../lib/activeJobSession";
import { rememberJobId } from "../../lib/jobRecent";
import { buildReferenceJobFields, type ReferenceRagMode } from "../../lib/jobReferencePayload";
import { PODCAST_ROOM_PRESETS, type PodcastRoomPresetKey } from "../../lib/notesRoomPresets";
import { ART_KIND_PRESETS, type ArtKindKey } from "../../lib/artKindPresets";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { jobEventsSourceUrl } from "../../lib/authHeaders";
import { useAuth } from "../../lib/auth";
import { maxNotesForReferencePlan } from "../../lib/noteReferenceLimits";
import { uploadNoteFileWithProgress } from "../../lib/uploadNoteFile";
import type { WorkItem } from "../../lib/worksTypes";

type NoteItem = {
  noteId: string;
  title?: string;
  notebook?: string;
  ext?: string;
  relativePath?: string;
  createdAt?: string;
  sourceUrl?: string;
  inputType?: string;
};

type NotesResp = {
  success?: boolean;
  notes?: NoteItem[];
  has_more?: boolean;
  error?: string;
};

type PreviewResp = {
  success?: boolean;
  title?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
};

const card =
  "rounded-2xl border border-line bg-white p-4 shadow-sm";
const inputCls =
  "rounded-lg border border-line bg-fill p-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

const LANG_OPTIONS_ART = ["中文", "English", "日本語"] as const;
const NOTE_PAGE = 30;
const NOTEBOOK_STATS_PAGE = 500;
const NOTEBOOK_CARD_THEMES = [
  {
    card: "border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-cyan-100/60",
    iconWrap: "bg-sky-100 text-sky-700",
    chip: "bg-sky-100/80 text-sky-800"
  },
  {
    card: "border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-100/60",
    iconWrap: "bg-violet-100 text-violet-700",
    chip: "bg-violet-100/80 text-violet-800"
  },
  {
    card: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-lime-100/60",
    iconWrap: "bg-emerald-100 text-emerald-700",
    chip: "bg-emerald-100/80 text-emerald-800"
  },
  {
    card: "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-100/60",
    iconWrap: "bg-amber-100 text-amber-700",
    chip: "bg-amber-100/80 text-amber-800"
  },
  {
    card: "border-rose-200/80 bg-gradient-to-br from-rose-50 via-white to-pink-100/60",
    iconWrap: "bg-rose-100 text-rose-700",
    chip: "bg-rose-100/80 text-rose-800"
  },
  {
    card: "border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-blue-100/60",
    iconWrap: "bg-indigo-100 text-indigo-700",
    chip: "bg-indigo-100/80 text-indigo-800"
  }
] as const;
const NOTEBOOK_ICONS = ["📘", "📙", "🗂️", "🧠", "🧪", "🪄", "🛰️", "📝"] as const;

type NotebookMeta = {
  noteCount: number;
  sourceCount: number;
  createdAt: string;
};

type NotebookVisual = {
  themeIndex: number;
  iconIndex: number;
};

const NOTEBOOK_VISUAL_STORAGE_KEY = "notes:notebook-visuals:v1";
const NOTES_REUSE_TEMPLATE_KEY = "fym_reuse_template_notes_v1";

function randomNotebookVisual(): NotebookVisual {
  return {
    themeIndex: Math.floor(Math.random() * NOTEBOOK_CARD_THEMES.length),
    iconIndex: Math.floor(Math.random() * NOTEBOOK_ICONS.length)
  };
}

function formatDisplayDate(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function FreshNoteSparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 2l1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2z"
        fill="currentColor"
        opacity={0.88}
      />
      <path
        d="M19 14l.6 2.4L22 17l-2.4.6L19 20l-.6-2.4L16 17l2.4-.6L19 14z"
        fill="currentColor"
        opacity={0.5}
      />
    </svg>
  );
}

export default function NotesPage() {
  const { user, phone, getAuthHeaders } = useAuth();
  const noteRefCap = useMemo(() => maxNotesForReferencePlan(String(user?.plan)), [user?.plan]);
  const createdByPhone = useMemo(() => String(user?.phone || phone || "").trim(), [user?.phone, phone]);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notebooks, setNotebooks] = useState<string[]>([]);
  const [notebookVisualByName, setNotebookVisualByName] = useState<Record<string, NotebookVisual>>({});
  const [notebookMetaByName, setNotebookMetaByName] = useState<Record<string, NotebookMeta>>({});
  const [selectedNotebook, setSelectedNotebook] = useState("");
  const [hubView, setHubView] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newNotebookName, setNewNotebookName] = useState("");
  const [notebookModalError, setNotebookModalError] = useState("");
  const [showNotebookModal, setShowNotebookModal] = useState(false);
  const [showRenameNotebook, setShowRenameNotebook] = useState(false);
  const [renameNotebookOld, setRenameNotebookOld] = useState("");
  const [renameNotebookNew, setRenameNotebookNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewKw, setPreviewKw] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [renameNoteId, setRenameNoteId] = useState<string | null>(null);
  const [renameNoteTitle, setRenameNoteTitle] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importUrlError, setImportUrlError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const addNoteFileRef = useRef<HTMLInputElement | null>(null);
  const [deleteNotebookConfirm, setDeleteNotebookConfirm] = useState(false);
  const [deleteNotebookTarget, setDeleteNotebookTarget] = useState<string | null>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState<string | null>(null);
  const [notebookCardMenu, setNotebookCardMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!noteMenuOpenId) return;
    const close = () => setNoteMenuOpenId(null);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-note-overflow-menu]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [noteMenuOpenId]);

  useEffect(() => {
    if (!notebookCardMenu) return;
    const close = () => setNotebookCardMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-notebook-card-overflow-menu]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [notebookCardMenu]);

  const [draftSelectedNoteIds, setDraftSelectedNoteIds] = useState<string[]>([]);

  useEffect(() => {
    setDraftSelectedNoteIds((prev) => (prev.length > noteRefCap ? prev.slice(0, noteRefCap) : prev));
  }, [noteRefCap]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [notePage, setNotePage] = useState(1);
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [freshNoteIds, setFreshNoteIds] = useState<string[]>([]);
  const freshNoteTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [showPodcastGenreModal, setShowPodcastGenreModal] = useState(false);
  const [podcastRoomPresetKey, setPodcastRoomPresetKey] = useState<PodcastRoomPresetKey>("custom");
  const [showPodcastRoomModal, setShowPodcastRoomModal] = useState(false);

  const [showArticleModal, setShowArticleModal] = useState(false);
  const [articleModalStep, setArticleModalStep] = useState<"pick" | "form">("pick");
  const [artKind, setArtKind] = useState<ArtKindKey>("custom");
  const [artLang, setArtLang] = useState("中文");
  const [artChars, setArtChars] = useState(2000);
  const [artCharsInput, setArtCharsInput] = useState("2000");
  const [artText, setArtText] = useState("");

  useEffect(() => {
    setArtCharsInput(String(artChars));
  }, [artChars]);

  const [podcastWorks, setPodcastWorks] = useState<WorkItem[]>([]);
  const [podcastWorksLoading, setPodcastWorksLoading] = useState(true);
  const [podcastWorksError, setPodcastWorksError] = useState("");
  const [podcastPhase, setPodcastPhase] = useState("");
  const [podcastProgressPct, setPodcastProgressPct] = useState(0);
  const [podcastBusy, setPodcastBusy] = useState(false);
  const podcastEventSourceRef = useRef<EventSource | null>(null);
  const podcastResolveWaitRef = useRef<(() => void) | null>(null);
  const podcastCancelledRef = useRef(false);
  const podcastRecoveryStartedRef = useRef(false);
  const podcastLogHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const podcastActiveJobIdRef = useRef<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  /** 来自 /notes?note=<id> 深链：解析笔记本并滚动到对应卡片 */
  const pendingFocusNoteIdRef = useRef<string | null>(null);
  const activeDraftJobIdRef = useRef<string | null>(null);
  const resolveDraftWaitRef = useRef<(() => void) | null>(null);
  const draftCancelledRef = useRef(false);
  const draftRecoveryStartedRef = useRef(false);

  const stats = useMemo(() => ({ total: notes.length }), [notes.length]);

  const markNoteAsFresh = useCallback((noteId: string) => {
    const id = noteId.trim();
    if (!id) return;
    setFreshNoteIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const existing = freshNoteTimeoutsRef.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setFreshNoteIds((prev) => prev.filter((x) => x !== id));
      freshNoteTimeoutsRef.current.delete(id);
    }, 15 * 60 * 1000);
    freshNoteTimeoutsRef.current.set(id, t);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of freshNoteTimeoutsRef.current.values()) clearTimeout(timer);
      freshNoteTimeoutsRef.current.clear();
    };
  }, []);

  const notesSorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
  }, [notes]);

  const noteTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of notes) {
      m[n.noteId] = n.title || n.noteId;
    }
    return m;
  }, [notes]);

  /** 仅本页（notes-podcast-studio 项目）产出的成片与文章 */
  const notesStudioWorks = useMemo(
    () => podcastWorks.filter((w) => w.projectName === NOTES_PODCAST_PROJECT_NAME),
    [podcastWorks]
  );

  /** 与 orchestrator list_notebooks 排序一致（zh-CN 字典序） */
  const mergeNotebookName = useCallback((list: string[], name: string) => {
    return [...new Set([...list, name])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, []);

  const loadNotebooks = useCallback(async () => {
    try {
      const res = await fetch("/api/notebooks", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json()) as { success?: boolean; notebooks?: string[] };
      if (res.ok && data.success && Array.isArray(data.notebooks)) {
        setNotebooks(data.notebooks);
      }
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  const loadNotebookMeta = useCallback(async () => {
    try {
      const map: Record<string, NotebookMeta> = {};
      let offset = 0;
      let shouldContinue = true;
      while (shouldContinue) {
        const q = new URLSearchParams({
          limit: String(NOTEBOOK_STATS_PAGE),
          offset: String(offset)
        });
        const res = await fetch(`/api/notes?${q.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as NotesResp & { detail?: unknown };
        if (!res.ok || !data.success || !Array.isArray(data.notes)) break;
        for (const note of data.notes) {
          const name = String(note.notebook || "").trim();
          if (!name) continue;
          if (!map[name]) {
            map[name] = { noteCount: 0, sourceCount: 0, createdAt: "" };
          }
          map[name].noteCount += 1;
          if (String(note.sourceUrl || "").trim()) {
            map[name].sourceCount += 1;
          }
          const createdTs = Date.parse(String(note.createdAt || ""));
          if (!Number.isNaN(createdTs)) {
            const currentTs = Date.parse(String(map[name].createdAt || ""));
            if (Number.isNaN(currentTs) || createdTs < currentTs) {
              map[name].createdAt = String(note.createdAt || "");
            }
          }
        }
        if (data.has_more) {
          offset += NOTEBOOK_STATS_PAGE;
        } else {
          shouldContinue = false;
        }
      }
      setNotebookMetaByName((prev) => {
        const merged = { ...map };
        for (const [name, meta] of Object.entries(prev)) {
          if (!merged[name]) merged[name] = meta;
        }
        return merged;
      });
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (notebooks.length === 0) {
      setSelectedNotebook("");
      setHubView(true);
      return;
    }
    if (selectedNotebook && !notebooks.includes(selectedNotebook)) {
      setSelectedNotebook(notebooks[0] ?? "");
      setHubView(true);
    }
  }, [notebooks, selectedNotebook]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let changed = false;
    let nextMap: Record<string, NotebookVisual> = {};
    try {
      const cached = window.localStorage.getItem(NOTEBOOK_VISUAL_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, NotebookVisual>;
        if (parsed && typeof parsed === "object") nextMap = { ...parsed };
      }
    } catch {
      // ignore
    }
    for (const nb of notebooks) {
      if (!nextMap[nb]) {
        nextMap[nb] = randomNotebookVisual();
        changed = true;
      }
    }
    const allowed = new Set(notebooks);
    for (const key of Object.keys(nextMap)) {
      if (!allowed.has(key)) {
        delete nextMap[key];
        changed = true;
      }
    }
    setNotebookVisualByName(nextMap);
    if (changed) {
      try {
        window.localStorage.setItem(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(nextMap));
      } catch {
        // ignore
      }
    }
  }, [notebooks]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedNotebook) params.set("notebook", selectedNotebook);
      params.set("limit", String(NOTE_PAGE));
      params.set("offset", String((notePage - 1) * NOTE_PAGE));
      const q = params.toString();
      const res = await fetch(`/api/notes?${q}`, { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as NotesResp & { detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, `加载失败 ${res.status}`));
      setNotes(data.notes || []);
      setHasMoreNotes(Boolean(data.has_more));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [selectedNotebook, notePage, getAuthHeaders]);

  useEffect(() => {
    setNotePage(1);
  }, [selectedNotebook]);

  useEffect(() => {
    void loadNotebooks();
    void loadNotebookMeta();
  }, [loadNotebookMeta, loadNotebooks]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(NOTES_REUSE_TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        notes_notebook?: string;
        text?: string;
        script_language?: string;
        script_target_chars?: number;
      };
      const nb = String(parsed.notes_notebook || "").trim();
      if (nb) {
        setSelectedNotebook(nb);
        setHubView(false);
      }
      const txt = String(parsed.text || "").trim();
      if (txt) setArtText(txt);
      const lang = String(parsed.script_language || "").trim();
      if (lang) setArtLang(lang);
      const chars = Number(parsed.script_target_chars || 0);
      if (Number.isFinite(chars) && chars >= 200 && chars <= 9999) {
        setArtChars(Math.round(chars));
        setArtCharsInput(String(Math.round(chars)));
      }
      setArtKind("custom");
      setArticleModalStep("form");
      setShowArticleModal(true);
      sessionStorage.removeItem(NOTES_REUSE_TEMPLATE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const nid = params.get("note");
      if (!nid) return;
      pendingFocusNoteIdRef.current = nid;
      void (async () => {
        try {
          const res = await fetch("/api/notes?limit=500", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
          const data = (await res.json().catch(() => ({}))) as NotesResp;
          if (!res.ok || !data.success || !Array.isArray(data.notes)) return;
          const hit = data.notes.find((x) => x.noteId === nid);
          if (!hit) return;
          setSelectedNotebook(String(hit.notebook || "").trim());
          setHubView(false);
        } catch {
          // ignore
        }
      })();
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const nid = pendingFocusNoteIdRef.current;
    if (!nid || hubView || loading) return;
    const found = notes.some((n) => n.noteId === nid);
    if (!found) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-note-id="${CSS.escape(nid)}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      pendingFocusNoteIdRef.current = null;
      try {
        window.history.replaceState(null, "", "/notes");
      } catch {
        // ignore
      }
    });
  }, [hubView, loading, notes]);

  useEffect(() => {
    if (!hubView && selectedNotebook.trim()) void loadNotes();
  }, [loadNotes, hubView, selectedNotebook]);

  useEffect(() => {
    if (!hubView && !selectedNotebook.trim()) setHubView(true);
  }, [hubView, selectedNotebook]);

  useEffect(() => {
    setDraftSelectedNoteIds([]);
  }, [selectedNotebook]);

  const fetchPodcastWorks = useCallback(async () => {
    setPodcastWorksError("");
    try {
      const res = await fetch("/api/works?limit=80&offset=0", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        ai?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
      setPodcastWorks(Array.isArray(data.ai) ? data.ai : []);
    } catch (e) {
      setPodcastWorksError(String(e instanceof Error ? e.message : e));
      setPodcastWorks([]);
    } finally {
      setPodcastWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void fetchPodcastWorks();
  }, [fetchPodcastWorks]);

  function applyPodcastTaskFromEvent(message: string, progressFromPayload?: number) {
    setPodcastPhase(message);
    if (typeof progressFromPayload === "number" && !Number.isNaN(progressFromPayload)) {
      setPodcastProgressPct(Math.min(100, Math.max(0, progressFromPayload)));
    }
  }

  const waitPodcastJobEvents = useCallback((jobId: string): Promise<void> => {
    return new Promise((resolve) => {
      podcastResolveWaitRef.current = resolve;
      const es = new EventSource(jobEventsSourceUrl(jobId, 0));
      podcastEventSourceRef.current = es;
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") {
            es.close();
            podcastEventSourceRef.current = null;
            podcastResolveWaitRef.current = null;
            resolve();
            return;
          }
          const msg = String(data.message || "").trim();
          const p = data.payload?.progress;
          if (msg) applyPodcastTaskFromEvent(msg, typeof p === "number" ? p : undefined);
          else if (typeof p === "number") setPodcastProgressPct(Math.min(100, Math.max(0, p)));
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        applyPodcastTaskFromEvent("连接中断，正在重试或结束…");
        es.close();
        podcastEventSourceRef.current = null;
        podcastResolveWaitRef.current = null;
        resolve();
      };
    });
  }, []);

  const finalizePodcastJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const terminal = (await fetch(`/api/jobs/${jobId}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const status = String(terminal.status || "");
        const err = String(terminal.error_message || "");
        const succeeded = status === "succeeded";
        if (succeeded) applyPodcastTaskFromEvent("生成完成", 100);
        else applyPodcastTaskFromEvent(err || "生成未成功");
        void fetchPodcastWorks();
        return succeeded;
      } catch (e) {
        applyPodcastTaskFromEvent(String(e instanceof Error ? e.message : e));
        void fetchPodcastWorks();
        return false;
      }
    },
    [fetchPodcastWorks, getAuthHeaders]
  );

  const onPodcastJobCreated = useCallback(
    (jobId: string) => {
      podcastCancelledRef.current = false;
      podcastActiveJobIdRef.current = jobId;
      if (podcastLogHideTimerRef.current) {
        clearTimeout(podcastLogHideTimerRef.current);
        podcastLogHideTimerRef.current = null;
      }
      setPodcastBusy(true);
      setPodcastProgressPct(5);
      applyPodcastTaskFromEvent("已提交，生成即将开始…", 5);
      rememberJobId(jobId);
      void (async () => {
        await waitPodcastJobEvents(jobId);
        if (!podcastCancelledRef.current) {
          const ok = await finalizePodcastJob(jobId);
          if (ok && !podcastCancelledRef.current) {
            podcastLogHideTimerRef.current = setTimeout(() => {
              setPodcastPhase("");
              setPodcastProgressPct(0);
              podcastLogHideTimerRef.current = null;
            }, 5000);
          }
        }
        clearActiveGenerationJob("podcast");
        podcastActiveJobIdRef.current = null;
        setPodcastBusy(false);
        podcastCancelledRef.current = false;
      })();
    },
    [waitPodcastJobEvents, finalizePodcastJob]
  );

  const stopPodcastGeneration = useCallback(async () => {
    if (podcastLogHideTimerRef.current) {
      clearTimeout(podcastLogHideTimerRef.current);
      podcastLogHideTimerRef.current = null;
    }
    const es = podcastEventSourceRef.current;
    podcastCancelledRef.current = true;
    es?.close();
    podcastEventSourceRef.current = null;
    podcastResolveWaitRef.current?.();
    podcastResolveWaitRef.current = null;
    try {
      const jid = podcastActiveJobIdRef.current || readActiveGenerationJob("podcast");
      if (jid) await cancelJob(jid);
    } catch {
      // ignore
    }
    podcastActiveJobIdRef.current = null;
    clearActiveGenerationJob("podcast");
    setPodcastBusy(false);
    applyPodcastTaskFromEvent("已取消");
  }, []);

  useEffect(() => {
    if (podcastRecoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("podcast");
    if (!sid) return;
    podcastRecoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("podcast");
          return;
        }
        if (st === "queued" || st === "running") {
          podcastCancelledRef.current = false;
          podcastActiveJobIdRef.current = sid;
          setPodcastBusy(true);
          setPodcastProgressPct(5);
          applyPodcastTaskFromEvent(`恢复未完成的生成 ${sid.slice(0, 8)}…`, 5);
          rememberJobId(sid);
          await waitPodcastJobEvents(sid);
          if (!podcastCancelledRef.current) await finalizePodcastJob(sid);
          podcastActiveJobIdRef.current = null;
        }
      } catch {
        clearActiveGenerationJob("podcast");
      } finally {
        clearActiveGenerationJob("podcast");
        setPodcastBusy(false);
        podcastCancelledRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时尝试恢复
  }, [waitPodcastJobEvents, finalizePodcastJob, getAuthHeaders]);

  useEffect(() => {
    return () => {
      if (podcastLogHideTimerRef.current) clearTimeout(podcastLogHideTimerRef.current);
    };
  }, []);

  const waitDraftJobEvents = useCallback((jobId: string): Promise<void> => {
    return new Promise((resolve) => {
      resolveDraftWaitRef.current = resolve;
      const es = new EventSource(jobEventsSourceUrl(jobId, 0));
      eventSourceRef.current = es;
      activeDraftJobIdRef.current = jobId;
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") {
            es.close();
            eventSourceRef.current = null;
            resolveDraftWaitRef.current = null;
            resolve();
            return;
          }
          const msg = String(data.message || "").trim();
          if (msg) setDraftMessage(msg);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        setDraftMessage("连接暂时中断，请到侧栏「创作记录」查看这一条的状态。");
        es.close();
        eventSourceRef.current = null;
        resolveDraftWaitRef.current = null;
        resolve();
      };
    });
  }, []);

  const finalizeDraftJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      const terminal = (await fetch(`/api/jobs/${jobId}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      }).then((r) => r.json())) as Record<string, unknown>;
      const status = String(terminal.status || "");
      const err = String(terminal.error_message || "");
      if (status === "succeeded") {
        setDraftMessage(`生成完成（${jobId.slice(0, 8)}…）。可在侧栏「创作记录」或右侧「笔记播客作品」里查看。`);
      } else {
        setDraftMessage(`处理结果：${status}${err ? ` — ${err}` : ""}`);
      }
    } catch (e) {
      setDraftMessage(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (draftRecoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("script_draft");
    if (!sid) return;
    draftRecoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("script_draft");
          return;
        }
        if (st === "queued" || st === "running") {
          draftCancelledRef.current = false;
          setDraftBusy(true);
          setDraftMessage(`恢复未完成的生成 ${sid}…`);
          rememberJobId(sid);
          activeDraftJobIdRef.current = sid;
          await waitDraftJobEvents(sid);
          if (!draftCancelledRef.current) await finalizeDraftJob(sid);
        }
      } catch {
        clearActiveGenerationJob("script_draft");
      } finally {
        clearActiveGenerationJob("script_draft");
        setDraftBusy(false);
        draftCancelledRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时尝试恢复
  }, [waitDraftJobEvents, finalizeDraftJob, getAuthHeaders]);

  async function createNotebook() {
    const name = newNotebookName.trim();
    if (!name) {
      setNotebookModalError("请输入笔记本名称");
      return;
    }
    setNotebookModalError("");
    setBusy(true);
    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "创建笔记本失败"));
      setSelectedNotebook(name);
      setNewNotebookName("");
      setShowNotebookModal(false);
      setError("");
      setNotebookMetaByName((prev) => ({
        ...prev,
        [name]: prev[name] || { noteCount: 0, sourceCount: 0, createdAt: new Date().toISOString() }
      }));
      setNotebookVisualByName((prev) => {
        if (prev[name]) return prev;
        const next = { ...prev, [name]: randomNotebookVisual() };
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
      setNotebooks((prev) => mergeNotebookName(prev, name));
      await loadNotebooks();
      await loadNotebookMeta();
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setNotebookModalError(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function renameNotebookSubmit() {
    const oldN = renameNotebookOld.trim();
    const newN = renameNotebookNew.trim();
    if (!oldN || !newN) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(oldN)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ new_name: newN })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "重命名失败"));
      if (selectedNotebook === oldN) setSelectedNotebook(newN);
      setShowRenameNotebook(false);
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function submitUrlImport() {
    const u = importUrl.trim();
    const nb = selectedNotebook.trim();
    setImportUrlError("");
    if (!u) {
      setImportUrlError("请输入有效的网页链接");
      return;
    }
    if (!nb) {
      setImportUrlError("请先选择或新建笔记本");
      return;
    }
    setImportBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notes/import_url", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          url: u,
          notebook: nb,
          title: importTitle.trim()
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        noteId?: string;
        error?: string;
        detail?: unknown;
      };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "导入失败"));
      if (data.noteId) markNoteAsFresh(data.noteId);
      setImportUrl("");
      setImportTitle("");
      setImportUrlError("");
      setShowAddNoteModal(false);
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setImportUrlError(String(err instanceof Error ? err.message : err));
    } finally {
      setImportBusy(false);
    }
  }

  async function confirmDeleteNotebook() {
    const target = deleteNotebookTarget || selectedNotebook;
    setDeleteNotebookConfirm(false);
    setDeleteNotebookTarget(null);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(target)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "删除失败"));
      if (selectedNotebook === target) {
        setSelectedNotebook("");
        setHubView(true);
      }
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    const nb = selectedNotebook.trim();
    if (!nb) {
      setError("请先进入某一笔记本后再上传");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const res = await uploadNoteFileWithProgress(file, {
        notebook: nb,
        onProgress: (p) => setUploadProgress(p)
      });
      if (!res.ok) throw new Error(res.error);
      const data = res.data;
      if (data.success === false) throw new Error(apiErrorMessage(data, "上传失败"));
      const newId = data.note?.noteId;
      if (newId) markNoteAsFresh(newId);
      setShowAddNoteModal(false);
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function toggleDraftNote(noteId: string) {
    setDraftSelectedNoteIds((prev) => {
      if (prev.includes(noteId)) return prev.filter((x) => x !== noteId);
      if (prev.length >= noteRefCap) {
        setError(`当前套餐最多勾选 ${noteRefCap} 本笔记作为资料（基础 1 / Pro 5 / Max 10）`);
        return prev;
      }
      setError("");
      return [...prev, noteId];
    });
  }

  async function submitArticleDraft() {
    if (draftSelectedNoteIds.length === 0) {
      setError("请至少勾选一条笔记");
      return;
    }
    const body = artText.trim();
    if (!body) {
      setError("请填写 AI 提词");
      return;
    }
    const preset = ART_KIND_PRESETS[artKind];
    const programName = (preset.programName && preset.programName.trim()) || "笔记文章";
    draftCancelledRef.current = false;
    setDraftBusy(true);
    setDraftMessage("");
    setError("");
    try {
      const data = await createJob({
        project_name: NOTES_PODCAST_PROJECT_NAME,
        job_type: "script_draft",
        queue_name: "ai",
        created_by: createdByPhone || undefined,
        payload: {
          text: body,
          script_target_chars: Math.min(9999, Math.max(200, artChars)),
          notes_notebook: selectedNotebook.trim(),
          ...buildReferenceJobFields({
            urlListText: "",
            selectedNoteIds: draftSelectedNoteIds,
            referenceExtra: "",
            useRag: true,
            ragMaxChars: 28_000,
            referenceRagMode: "truncate" as ReferenceRagMode
          }),
          script_style: "简洁清晰，重点突出",
          script_language: artLang,
          program_name: programName,
          speaker1_persona: "主持人",
          speaker2_persona: "分析师",
          script_constraints: "",
          output_mode: "article"
        }
      });
      rememberJobId(data.id);
      setActiveGenerationJob("script_draft", data.id);
      setDraftMessage(`记录 ${data.id.slice(0, 8)}…：已创建，正在监听进度`);
      setShowArticleModal(false);
      setArticleModalStep("pick");
      activeDraftJobIdRef.current = data.id;
      await waitDraftJobEvents(data.id);
      if (!draftCancelledRef.current) await finalizeDraftJob(data.id);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      clearActiveGenerationJob("script_draft");
      setDraftBusy(false);
      activeDraftJobIdRef.current = null;
    }
  }

  async function confirmDeleteNote(noteId: string) {
    setDeleteNoteId(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "删除失败"));
      await loadNotes();
      await loadNotebooks();
      await loadNotebookMeta();
      setDraftSelectedNoteIds((prev) => prev.filter((x) => x !== noteId));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(noteId: string) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewTitle("");
    setPreviewText("");
    setPreviewTruncated(false);
    setPreviewKw("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/preview_text`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as PreviewResp & { detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "预览失败"));
      setPreviewTitle(data.title || "");
      setPreviewText(data.text || "");
      setPreviewTruncated(!!data.truncated);
    } catch (err) {
      setPreviewText(String(err instanceof Error ? err.message : err));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveRenameNote() {
    if (!renameNoteId) return;
    const t = renameNoteTitle.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(renameNoteId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: t })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "重命名失败"));
      setRenameNoteId(null);
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const filteredPreview = useMemo(() => {
    const kw = previewKw.trim();
    if (!kw) return previewText;
    const lines = previewText.split("\n");
    return lines.filter((l) => l.includes(kw)).join("\n");
  }, [previewText, previewKw]);

  function openNotebook(name: string) {
    setSelectedNotebook(name);
    setHubView(false);
    setError("");
  }

  function openPodcastFlow() {
    if (!selectedNotebook.trim()) {
      setError("生成播客：请先进入某一笔记本");
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setError("生成播客：请先在笔记列表中勾选至少一条笔记");
      return;
    }
    setError("");
    setShowPodcastGenreModal(true);
  }

  function openArticleFlow() {
    if (!selectedNotebook.trim()) {
      setError("生成文章：请先进入某一笔记本");
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setError("生成文章：请先在笔记列表中勾选至少一条笔记");
      return;
    }
    setError("");
    setArticleModalStep("pick");
    setArtKind("custom");
    setArtLang("中文");
    setArtChars(2000);
    setArtText("");
    setShowArticleModal(true);
  }

  function pickArticleKind(k: ArtKindKey) {
    setArtKind(k);
    if (k === "custom") setArtText("");
    else setArtText(ART_KIND_PRESETS[k].textPrefix);
    setArticleModalStep("form");
  }

  function commitArtCharsInput() {
    const parsed = Number(artCharsInput);
    if (Number.isNaN(parsed)) {
      setArtCharsInput(String(artChars));
      return;
    }
    const clamped = Math.min(9999, Math.max(200, Math.round(parsed)));
    setArtChars(clamped);
    setArtCharsInput(String(clamped));
  }

  const modeCard =
    "flex min-h-[5.5rem] flex-col justify-center rounded-xl border p-4 text-left transition-colors " +
    "border-line bg-fill/80 hover:border-brand/40";

  const podcastEtaMinutes =
    podcastBusy || podcastProgressPct > 0
      ? podcastProgressPct >= 100
        ? 0
        : Math.max(1, Math.ceil(((100 - podcastProgressPct) / 100) * Math.max(5, Math.min(48, 25))))
      : 0;

  const showPodcastTaskPanel = podcastBusy || podcastPhase.length > 0;

  return (
    <main className="mx-auto min-h-0 w-full max-w-[min(100%,1800px)] px-3 pb-10 sm:px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">笔记播客</h1>
        <p className="mt-2 text-sm text-muted">
          每一个想法，都自带频率。输入文稿，此刻，全世界都在听你
        </p>
      </div>

      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      {/* 在笔记本列表页无法看到右侧「我的作品」时，仍显示文章/底稿生成日志（如页面恢复未完成 job） */}
      {hubView && draftMessage ? (
        <div
          className={`mb-4 rounded-xl border px-3 py-2 text-xs ${
            draftBusy
              ? "border-brand/25 bg-fill/90 text-brand"
              : "border-emerald-200/80 bg-emerald-50/80 text-emerald-900"
          }`}
          role="status"
          aria-live="polite"
        >
          {draftMessage}
        </div>
      ) : null}

      {hubView ? (
        <section className={card}>
          <h2 className="text-base font-semibold text-ink">笔记本</h2>
          <p className="mt-1 text-xs text-muted">点击加号新建你的笔记本，上传笔记。</p>
          {notebooks.length === 0 ? (
            <p className="mt-3 text-sm text-muted">暂无笔记本，请先点下方「新建笔记本」添加。</p>
          ) : null}
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            <button
              type="button"
              onClick={() => {
                setNotebookModalError("");
                setShowNotebookModal(true);
                setNewNotebookName("");
              }}
              className="flex min-h-[170px] min-w-[188px] max-w-[240px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/40 bg-fill/50 text-muted hover:bg-fill"
            >
              <span className="text-5xl font-light leading-none text-brand">+</span>
              <span className="mt-2 text-sm font-medium text-brand">新建笔记本</span>
            </button>
            {notebooks.map((nb) => {
              const picked = notebookVisualByName[nb];
              const visual = {
                theme: NOTEBOOK_CARD_THEMES[picked?.themeIndex ?? 0],
                icon: NOTEBOOK_ICONS[picked?.iconIndex ?? 0]
              };
              const meta = notebookMetaByName[nb];
              return (
                <div
                  key={nb}
                  className={`relative flex min-h-[170px] min-w-[188px] max-w-[240px] shrink-0 flex-col rounded-2xl border p-3 shadow-sm ${visual.theme.card}`}
                >
                <div className="absolute right-2 top-2">
                  <span className="relative flex" data-notebook-card-overflow-menu>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-muted hover:bg-fill"
                      aria-label="更多"
                      aria-expanded={notebookCardMenu === nb}
                      onClick={() => setNotebookCardMenu((x) => (x === nb ? null : nb))}
                    >
                      ⋯
                    </button>
                    {notebookCardMenu === nb ? (
                      <div className="absolute right-0 top-full z-20 mt-0.5 min-w-[7rem] rounded-md border border-line bg-white py-0.5 text-[11px] shadow-lg">
                        <button
                          type="button"
                          className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                          onClick={() => {
                            setRenameNotebookOld(nb);
                            setRenameNotebookNew("");
                            setShowRenameNotebook(true);
                            setNotebookCardMenu(null);
                          }}
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          className="block w-full px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50"
                          onClick={() => {
                            setDeleteNotebookTarget(nb);
                            setDeleteNotebookConfirm(true);
                            setNotebookCardMenu(null);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  className="flex flex-1 flex-col justify-between pr-6 text-left"
                  onClick={() => openNotebook(nb)}
                >
                  <div>
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base ${visual.theme.iconWrap}`}
                      aria-hidden
                    >
                      {visual.icon}
                    </span>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-ink">{nb}</p>
                  </div>
                  <div className="mt-3 space-y-1.5 text-[11px] text-slate-600">
                    <p>创建时间：{formatDisplayDate(meta?.createdAt)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 ${visual.theme.chip}`}>
                        来源 {meta?.sourceCount ?? 0}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 ${visual.theme.chip}`}>
                        笔记 {meta?.noteCount ?? 0}
                      </span>
                    </div>
                    <p className="text-muted">点击进入</p>
                  </div>
                </button>
              </div>
              );
            })}
          </div>
        </section>
      ) : (
        <>
          <div className="mb-4">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-lg text-ink hover:bg-fill"
              aria-label="返回笔记本列表"
              title="返回笔记本列表"
              onClick={() => setHubView(true)}
            >
              ←
            </button>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
            <section
              className={`${card} flex min-h-[min(100vh-12rem,920px)] flex-col lg:w-1/4 lg:max-w-[25%] lg:shrink-0`}
            >
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">笔记本内容</h2>
                </div>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-fill text-xl font-medium text-ink shadow-sm hover:bg-fill"
                  aria-label="添加笔记"
                  title="添加笔记"
                  onClick={() => {
                    setImportUrlError("");
                    setShowAddNoteModal(true);
                  }}
                >
                  +
                </button>
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-muted">笔记</h3>
                  <span className="text-right text-[11px] leading-snug text-muted">
                    资料上限 {draftSelectedNoteIds.length}/{noteRefCap} · 本页 {stats.total} 条
                    {hasMoreNotes ? " · 仍有更多" : ""}
                  </span>
                </div>
                {loading ? <p className="text-sm text-muted">加载中…</p> : null}
                <div className="mt-2 space-y-2">
                  {notesSorted.map((n) => (
                    <div
                      key={n.noteId}
                      data-note-id={n.noteId}
                      className="rounded-xl border border-line bg-fill/80 p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-brand"
                          checked={draftSelectedNoteIds.includes(n.noteId)}
                          onChange={() => toggleDraftNote(n.noteId)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1">
                            <p className="min-w-0 truncate text-sm font-medium text-ink">{n.title || n.noteId}</p>
                            {freshNoteIds.includes(n.noteId) ? (
                              <span
                                className="inline-flex shrink-0 text-amber-500"
                                title="刚加入，可作播客资料"
                                role="img"
                                aria-label="刚加入的资料"
                              >
                                <FreshNoteSparkleIcon />
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted">{(n.ext || "-") + " · " + (n.createdAt || "-")}</p>
                        </div>
                        <div className="relative shrink-0" data-note-overflow-menu>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-track"
                            aria-label="更多"
                            aria-expanded={noteMenuOpenId === n.noteId}
                            onClick={() => setNoteMenuOpenId((x) => (x === n.noteId ? null : n.noteId))}
                          >
                            ⋯
                          </button>
                          {noteMenuOpenId === n.noteId ? (
                            <div className="absolute right-0 top-full z-10 mt-0.5 min-w-[7rem] rounded-md border border-line bg-white py-0.5 text-[11px] shadow-lg">
                              <button
                                type="button"
                                className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                                onClick={() => {
                                  void openPreview(n.noteId);
                                  setNoteMenuOpenId(null);
                                }}
                              >
                                预览
                              </button>
                              <button
                                type="button"
                                className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                                onClick={() => {
                                  setRenameNoteId(n.noteId);
                                  setRenameNoteTitle(n.title || "");
                                  setDeleteNoteId(null);
                                  setNoteMenuOpenId(null);
                                }}
                              >
                                改名
                              </button>
                              <button
                                type="button"
                                className="block w-full px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50"
                                onClick={() => {
                                  setDeleteNoteId(n.noteId);
                                  setRenameNoteId(null);
                                  setNoteMenuOpenId(null);
                                }}
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {renameNoteId === n.noteId ? (
                        <div className="mt-2 border-t border-line pt-2">
                          <InlineTextPrompt
                            open
                            title="重命名笔记"
                            value={renameNoteTitle}
                            onChange={setRenameNoteTitle}
                            onSubmit={() => void saveRenameNote()}
                            onCancel={() => setRenameNoteId(null)}
                            className="border-line bg-canvas/80"
                          />
                        </div>
                      ) : null}
                      {deleteNoteId === n.noteId ? (
                        <div className="mt-2 border-t border-line pt-2">
                          <InlineConfirmBar
                            open
                            message="确认删除这条笔记吗？"
                            confirmLabel="删除"
                            cancelLabel="取消"
                            danger
                            onConfirm={() => void confirmDeleteNote(n.noteId)}
                            onCancel={() => setDeleteNoteId(null)}
                            className="border-rose-200/50 bg-rose-950/30"
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!loading && notesSorted.length === 0 ? (
                    <EmptyState
                      title="暂无笔记"
                      description="使用右上角「+」添加文件或文本，或从 URL 导入。"
                      className="mt-2 border-none bg-transparent py-8"
                    />
                  ) : null}
                  {!loading && (notePage > 1 || hasMoreNotes) ? (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                        disabled={notePage <= 1}
                        onClick={() => setNotePage((p) => Math.max(1, p - 1))}
                      >
                        上一页
                      </button>
                      <span className="text-muted">第 {notePage} 页</span>
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                        disabled={!hasMoreNotes}
                        onClick={() => setNotePage((p) => p + 1)}
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="flex min-w-0 flex-1 flex-col gap-4 lg:w-3/4">
              <section className={card}>
                <h2 className="text-base font-semibold text-ink">工作坊</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button type="button" className={modeCard} onClick={() => openPodcastFlow()}>
                    <span className="text-sm font-semibold text-ink">生成播客</span>
                  </button>
                  <button type="button" className={modeCard} onClick={() => openArticleFlow()}>
                    <span className="text-sm font-semibold text-ink">生成文章</span>
                  </button>
                </div>
              </section>

              <section className={`${card} min-h-0 flex-1`}>
              <h2 className="text-lg font-semibold text-ink">我的作品</h2>
              {draftMessage ? (
                <div
                  className={`mt-4 rounded-xl border px-3 py-2 text-xs ${
                    draftBusy
                      ? "border-brand/25 bg-fill/90 text-brand"
                      : "border-emerald-200/80 bg-emerald-50/80 text-emerald-900"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {draftMessage}
                </div>
              ) : null}
              {showPodcastTaskPanel ? (
                <div className="mt-4 rounded-2xl border border-brand/25 bg-fill/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">生成进度</h3>
                    {podcastBusy ? (
                      <button
                        type="button"
                        className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                        onClick={() => void stopPodcastGeneration()}
                      >
                        停止
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-ink">{podcastPhase || (podcastBusy ? "处理中…" : "—")}</p>
                  {podcastBusy || podcastProgressPct > 0 ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      阶段含：参考汇总 → 脚本生成 → 语音合成（含开场/结尾）→ 封面；长稿或网络素材会更久。
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-track/90">
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, podcastProgressPct))}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                      <span>{podcastProgressPct > 0 ? `${podcastProgressPct}%` : podcastBusy ? "排队中" : ""}</span>
                      <span>
                        {podcastBusy || podcastProgressPct > 0
                          ? podcastProgressPct >= 100
                            ? "已完成"
                            : `预估剩余约 ${podcastEtaMinutes} 分钟`
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mt-6">
              <PodcastWorksGallery
                works={notesStudioWorks}
                loading={podcastWorksLoading}
                fetchError={podcastWorksError}
                onDismissError={() => setPodcastWorksError("")}
                onWorkDeleted={() => void fetchPodcastWorks()}
                variant="notes_studio"
              />
              </div>
            </section>
            </div>
          </div>
        </>
      )}

      {showAddNoteModal ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-note-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !importBusy && !uploading) setShowAddNoteModal(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-white p-4 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="add-note-title" className="text-base font-semibold text-ink">
                添加笔记
              </h2>
              <button
                type="button"
                className="text-sm text-muted hover:text-ink"
                onClick={() => !importBusy && !uploading && setShowAddNoteModal(false)}
                disabled={importBusy || uploading}
              >
                关闭
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">从链接导入或上传本地文件，将保存到当前笔记本。</p>
            <div className="mt-4 space-y-2">
              <label className="block text-xs text-ink">
                网页链接
                <input
                  className={`mt-1 block w-full ${inputCls}`}
                  placeholder="https://..."
                  value={importUrl}
                  onChange={(e) => {
                    setImportUrl(e.target.value);
                    if (importUrlError) setImportUrlError("");
                  }}
                  aria-invalid={Boolean(importUrlError)}
                  aria-describedby={importUrlError ? "import-url-err" : undefined}
                />
                {importUrlError ? (
                  <p id="import-url-err" className="mt-1 text-xs font-medium text-danger" role="alert">
                    {importUrlError}
                  </p>
                ) : null}
              </label>
              <label className="block text-xs text-ink">
                标题（可选）
                <input
                  className={`mt-1 block w-full ${inputCls}`}
                  placeholder="留空则使用页面标题"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                disabled={importBusy}
                onClick={() => void submitUrlImport()}
              >
                {importBusy ? "导入中…" : "导入链接"}
              </button>
            </div>
            <div className="my-4 border-t border-line" />
            <div className="space-y-2">
              <p className="text-xs text-muted">上传本地文件</p>
              <input
                ref={addNoteFileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  void uploadFile(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
                disabled={uploading}
                title={uploading ? "上传过程中请稍候" : undefined}
                onClick={() => addNoteFileRef.current?.click()}
              >
                {uploading ? (uploadProgress != null && uploadProgress < 100 ? `上传中 ${uploadProgress}%` : "处理中…") : "选择文件"}
              </button>
              {uploading && uploadProgress != null ? (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-brand transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-[11px] text-muted">
                    {uploadProgress < 100 ? "正在将文件传至服务器…" : "已完成传输，正在解析与保存…"}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showNotebookModal ? (
        <SmallPromptModal
          open
          title="新建笔记本"
          value={newNotebookName}
          onChange={(v) => {
            setNotebookModalError("");
            setNewNotebookName(v);
          }}
          onSubmit={() => void createNotebook()}
          onCancel={() => {
            setShowNotebookModal(false);
            setNewNotebookName("");
            setNotebookModalError("");
          }}
          placeholder="笔记本名称"
          submitLabel="创建"
          busy={busy}
          error={notebookModalError || null}
        />
      ) : null}
      {showRenameNotebook ? (
        <SmallPromptModal
          open
          title={`重命名笔记本（从「${renameNotebookOld}」改为）`}
          value={renameNotebookNew}
          onChange={setRenameNotebookNew}
          onSubmit={() => void renameNotebookSubmit()}
          onCancel={() => setShowRenameNotebook(false)}
          placeholder="新名称"
          submitLabel="保存"
          busy={busy}
        />
      ) : null}
      {deleteNotebookConfirm ? (
        <InlineConfirmBar
          open
          message={`确认删除笔记本「${deleteNotebookTarget || selectedNotebook}」？其下笔记将永久删除（不可从笔记回收站恢复）；由该笔记本资料生成的播客与文章将移入作品回收站。`}
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          closeOnOutsideClick={false}
          onConfirm={() => void confirmDeleteNotebook()}
          onCancel={() => {
            setDeleteNotebookConfirm(false);
            setDeleteNotebookTarget(null);
          }}
          className="border-rose-200/50 bg-rose-950/30"
        />
      ) : null}

      {showPodcastGenreModal ? (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="genre-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setShowPodcastGenreModal(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-white p-4 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id="genre-title" className="text-base font-semibold text-ink">
              选择播客体裁
            </h2>
            <p className="mt-1 text-xs text-muted">点选一种体裁后将直接打开参数配置（与主站 AI 播客同款）。</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(Object.keys(PODCAST_ROOM_PRESETS) as PodcastRoomPresetKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="rounded-xl border border-line bg-fill/90 p-3 text-left transition-colors hover:border-brand/50 hover:bg-white"
                  onClick={() => {
                    setPodcastRoomPresetKey(k);
                    setShowPodcastGenreModal(false);
                    setShowPodcastRoomModal(true);
                  }}
                >
                  <span className="text-sm font-semibold text-ink">{PODCAST_ROOM_PRESETS[k].label}</span>
                  <span className="mt-1 block text-[10px] text-muted">{k}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => setShowPodcastGenreModal(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <NotesPodcastRoomModal
        open={showPodcastRoomModal}
        onClose={() => setShowPodcastRoomModal(false)}
        notebookName={selectedNotebook}
        lockedNoteIds={draftSelectedNoteIds}
        maxLockedNotes={noteRefCap}
        noteTitleById={noteTitleById}
        presetKey={podcastRoomPresetKey}
        onPodcastJobCreated={onPodcastJobCreated}
      />

      {showArticleModal ? (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="article-modal-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !draftBusy) {
              setShowArticleModal(false);
              setArticleModalStep("pick");
            }
          }}
        >
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {articleModalStep === "pick" ? (
              <>
                <h2 id="article-modal-title" className="text-base font-semibold text-ink">
                  选择文章体裁
                </h2>
                <p className="mt-1 text-xs text-muted">点选体裁后进入参数与提词编辑。</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(Object.keys(ART_KIND_PRESETS) as ArtKindKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="rounded-xl border border-line bg-fill/90 p-3 text-left transition-colors hover:border-violet-400 hover:bg-white"
                      onClick={() => pickArticleKind(k)}
                    >
                      <span className="text-sm font-semibold text-ink">{ART_KIND_PRESETS[k].label}</span>
                      <span className="mt-1 block text-[10px] text-muted">{k}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                    onClick={() => {
                      setShowArticleModal(false);
                      setArticleModalStep("pick");
                    }}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-ink">生成文章</h2>
                    <p className="mt-1 text-xs text-muted">
                      体裁：{ART_KIND_PRESETS[artKind].label} · 可编辑 AI 提词
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-brand hover:underline"
                    onClick={() => setArticleModalStep("pick")}
                  >
                    ← 重选体裁
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-ink">
                    语言
                    <select
                      className={`mt-1 block w-full ${inputCls}`}
                      value={artLang}
                      onChange={(e) => setArtLang(e.target.value)}
                    >
                      {LANG_OPTIONS_ART.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-ink">
                    目标字数（200–9999）
                    <input
                      type="number"
                      min={200}
                      max={9999}
                      className={`mt-1 block w-full ${inputCls}`}
                      value={artCharsInput}
                      onChange={(e) => setArtCharsInput(e.target.value)}
                      onBlur={commitArtCharsInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitArtCharsInput();
                        }
                      }}
                    />
                  </label>
                </div>
                <label className="mt-3 block text-xs text-ink">
                  AI 提词（可编辑）
                  <textarea
                    className={`mt-1 min-h-32 w-full ${inputCls}`}
                    value={artText}
                    onChange={(e) => setArtText(e.target.value)}
                    placeholder="将依据所选笔记与上述提词生成文章。"
                  />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                    disabled={draftBusy}
                    onClick={() => {
                      if (!draftBusy) {
                        setShowArticleModal(false);
                        setArticleModalStep("pick");
                      }
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
                    disabled={draftBusy}
                    onClick={() => void submitArticleDraft()}
                  >
                    {draftBusy ? "创建中…" : "生成节目底稿"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div
          className="fixed inset-0 z-[270] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-preview-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className="max-h-[min(92vh,820px)] w-full max-w-5xl overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
            <NoteMarkdownPreview
              title={previewTitle || "笔记预览"}
              filteredText={filteredPreview}
              loading={previewLoading}
              truncated={previewTruncated}
              keyword={previewKw}
              onKeywordChange={setPreviewKw}
              onClose={() => setPreviewOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
