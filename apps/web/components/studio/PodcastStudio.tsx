"use client";

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction
} from "react";
import { jobEventsSourceUrl } from "../../lib/authHeaders";
import { cancelJob, formatOrchestratorErrorText, previewMediaJob } from "../../lib/api";
import { buildReferenceJobFields } from "../../lib/jobReferencePayload";
import { rememberJobId } from "../../lib/jobRecent";
import { clearActiveGenerationJob, readActiveGenerationJob, setActiveGenerationJob } from "../../lib/activeJobSession";
import PodcastWorksGallery from "../podcast/PodcastWorksGallery";
import CreativeTemplatePicker from "./CreativeTemplatePicker";
import { chipClass } from "./chipStyles";
import { PlayIcon, StopIcon } from "./MediaIcons";
import { VoiceSelect, type VoiceOpt } from "./VoiceSelect";
import BgmControlRow from "./BgmControlRow";
import IntroOutroPresetBar from "./IntroOutroPresetBar";
import { bgmSegmentPayloadFromState, type BgmUiMode } from "../../lib/bgmUpload";
import { buildIntroOutroSnapshot, type IntroOutroSnapshotV1 } from "../../lib/introOutroSnapshot";
import { readLastIntroOutro, writeLastIntroOutro } from "../../lib/introOutroStorage";
import { PODCAST_PRESET_VOICES } from "../../lib/podcastVoiceDefaults";
import {
  buildScriptPayload,
  buildVoiceOptionsFromMaps,
  DEFAULT_PROGRAM_NAME,
  DURATION_PRESETS,
  LANG_OPTIONS,
  durationInputMatchesCommitted,
  refsFromUrlBlock,
  resolveScriptTargetCharsForJob,
  resolveVoiceId
} from "../../lib/podcastStudioCommon";
import { useAuth, userAccountRef } from "../../lib/auth";
import { maxNotesForReferencePlan } from "../../lib/noteReferenceLimits";
import { PlanTierHint } from "../PlanTierHint";
import {
  creativeBundleFromTemplateValue,
  DEFAULT_CREATIVE_TEMPLATE_VALUE,
  formatCreativeTemplateChip,
  resolveCreativeBundle
} from "../../lib/creativeTemplates";
import { DEFAULT_INGEST_NOTEBOOK_NAME, NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { uploadNoteFileWithProgress } from "../../lib/uploadNoteFile";
import type { WorkItem } from "../../lib/worksTypes";
import FloatingPopover from "../ui/FloatingPopover";
import {
  CREATIVE_CHIP_HOVER_HINT
} from "../../lib/studioHoverHints";

type PanelId = "mode" | "lang" | "voice" | "duration" | "intro" | "creative" | "library" | null;

const LISTENHUB_CREATIVE_HINTS = [
  "将你最感兴趣的一本书或一篇文章，做成一期深度闲聊播客。",
  "把最近一周的科技新闻，整理成一期「划重点」对话节目。",
  "用轻松语气讲解一个职业或技能入门，面向完全外行听众。"
] as const;

const MAIN_TEXT_PLACEHOLDER = "主题或素材正文";
const PODCAST_PREFS_KEY = "fym_podcast_user_prefs_v1";
const PARTIAL_REDO_KEY = "fym_podcast_partial_redo_v1";
const PODCAST_REUSE_TEMPLATE_KEY = "fym_reuse_template_podcast_v1";
type PartialRedoMeta = {
  sourceJobId?: string;
  scopeLabel: string;
  prompt: string;
};

export type PodcastStudioActivity = {
  busy: boolean;
  phase: string;
  progressPct: number;
};

export type PodcastStudioHandle = {
  generate: () => void;
  stop: () => void;
};

export type PodcastStudioProps = {
  /** 创作页：由父级提供正文，不渲染顶部大文本框 */
  contentText?: string;
  onContentTextChange?: (value: string) => void;
  /** 嵌入布局：隐藏页级标题、快速示例与独立「生成结果」区（由父级统一展示时可传 true） */
  embedded?: boolean;
  /** 与父级同一张卡片：去掉内层圆角描边，内边距交父级控制 */
  blendOuterCard?: boolean;
  /** 由父级渲染主生成按钮时隐藏工具条内按钮 */
  hideGenerateButton?: boolean;
  /** 与独立页一致时在底部展示作品库；嵌入创作页时可关闭 */
  showGallery?: boolean;
  onActivityChange?: (s: PodcastStudioActivity) => void;
  /** 嵌入且无作品区时：任务结束后通知父级刷新列表 */
  onExternalListRefresh?: () => void;
  /** 资料库当前选择摘要（链接条数 / 笔记标题），供创作页在正文框角标展示 */
  onLibrarySelectionPreviewChange?: (summary: string) => void;
};

const PodcastStudio = forwardRef<PodcastStudioHandle, PodcastStudioProps>(function PodcastStudio(
  {
    contentText: controlledText,
    onContentTextChange,
    embedded = false,
    blendOuterCard = false,
    hideGenerateButton = false,
    showGallery = true,
    onActivityChange,
    onExternalListRefresh,
    onLibrarySelectionPreviewChange
  },
  ref
) {
  const { user, phone, getAuthHeaders } = useAuth();
  const noteRefCap = useMemo(() => maxNotesForReferencePlan(String(user?.plan)), [user?.plan]);
  const createdByPhone = useMemo(() => userAccountRef(user) || String(phone || "").trim(), [user, phone]);

  const [uncontrolledText, setUncontrolledText] = useState("");
  const text = controlledText !== undefined ? controlledText : uncontrolledText;
  const setText = useCallback(
    (next: SetStateAction<string>) => {
      if (controlledText !== undefined) {
        const v = typeof next === "function" ? (next as (p: string) => string)(controlledText) : next;
        onContentTextChange?.(v);
      } else {
        setUncontrolledText(next);
      }
    },
    [controlledText, onContentTextChange]
  );
  const [referenceUrlsBlock, setReferenceUrlsBlock] = useState("");
  const [notebookFilter, setNotebookFilter] = useState("全部");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [scriptTargetChars, setScriptTargetChars] = useState(800);
  const [scriptTargetCharsInput, setScriptTargetCharsInput] = useState("800");
  const [creativeTemplateValue, setCreativeTemplateValue] = useState(DEFAULT_CREATIVE_TEMPLATE_VALUE);
  const [scriptLanguage, setScriptLanguage] = useState("中文");
  const creativeBundle = useMemo(() => resolveCreativeBundle(creativeTemplateValue), [creativeTemplateValue]);
  const [generateCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const [taskPhase, setTaskPhase] = useState("");
  const [taskProgressPct, setTaskProgressPct] = useState(0);
  const [notesList, setNotesList] = useState<{ noteId: string; title?: string; notebook?: string }[]>([]);
  const [studioNotebooks, setStudioNotebooks] = useState<string[]>([]);
  /** 资料库内仅允许单选一条笔记（与产品默认一致） */
  const LIBRARY_MAX_SELECTED_NOTES = 1;
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksError, setWorksError] = useState("");

  const [speakerMode, setSpeakerMode] = useState<"single" | "dual">("dual");
  const [introText, setIntroText] = useState("");
  const [outroText, setOutroText] = useState("");
  const [introVoiceFollow, setIntroVoiceFollow] = useState(true);
  const [introVoiceKey, setIntroVoiceKey] = useState("mini");
  const [outroVoiceFollow, setOutroVoiceFollow] = useState(true);
  const [outroVoiceKey, setOutroVoiceKey] = useState("mini");
  const [introBgm1Mode, setIntroBgm1Mode] = useState<BgmUiMode>("none");
  const [introBgm2Mode, setIntroBgm2Mode] = useState<BgmUiMode>("none");
  const [outroBgm3Mode, setOutroBgm3Mode] = useState<BgmUiMode>("none");
  const [introBgm1File, setIntroBgm1File] = useState<File | null>(null);
  const [introBgm2File, setIntroBgm2File] = useState<File | null>(null);
  const [outroBgm3File, setOutroBgm3File] = useState<File | null>(null);
  const [introBgm1StoredHex, setIntroBgm1StoredHex] = useState<string | null>(null);
  const [introBgm2StoredHex, setIntroBgm2StoredHex] = useState<string | null>(null);
  const [outroBgm3StoredHex, setOutroBgm3StoredHex] = useState<string | null>(null);
  const [introOutroHydrated, setIntroOutroHydrated] = useState(false);
  const [defaultVoicesMap, setDefaultVoicesMap] = useState<Record<string, Record<string, unknown>>>({});
  const [savedCustomVoices, setSavedCustomVoices] = useState<{ voiceId: string; displayName?: string }[]>([]);
  const [voiceKey1, setVoiceKey1] = useState("mini");
  const [voiceKey2, setVoiceKey2] = useState("max");
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [partialRedoMeta, setPartialRedoMeta] = useState<PartialRedoMeta | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const resolveWaitRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  const logSuccessHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryStartedRef = useRef(false);

  const stopPanelPointer = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const applyIntroOutroSnapshot = useCallback((s: IntroOutroSnapshotV1) => {
    setIntroText(s.introText);
    setOutroText(s.outroText);
    setIntroVoiceFollow(s.introVoiceFollow);
    setIntroVoiceKey(s.introVoiceKey);
    setOutroVoiceFollow(s.outroVoiceFollow);
    setOutroVoiceKey(s.outroVoiceKey);
    setIntroBgm1Mode(s.introBgm1Mode);
    setIntroBgm2Mode(s.introBgm2Mode);
    setOutroBgm3Mode(s.outroBgm3Mode);
    setIntroBgm1File(null);
    setIntroBgm2File(null);
    setOutroBgm3File(null);
    setIntroBgm1StoredHex(s.introBgm1Hex ?? null);
    setIntroBgm2StoredHex(s.introBgm2Hex ?? null);
    setOutroBgm3StoredHex(s.outroBgm3Hex ?? null);
  }, []);

  useEffect(() => {
    const last = readLastIntroOutro("podcast");
    if (last) applyIntroOutroSnapshot(last);
    setIntroOutroHydrated(true);
  }, [applyIntroOutroSnapshot]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PODCAST_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { defaultExpandAdvanced?: boolean; defaultScriptTargetChars?: number };
      if (typeof parsed.defaultExpandAdvanced === "boolean") setShowAdvanced(parsed.defaultExpandAdvanced);
      if (typeof parsed.defaultScriptTargetChars === "number" && Number.isFinite(parsed.defaultScriptTargetChars)) {
        const n = Math.max(200, Math.min(50000, Math.round(parsed.defaultScriptTargetChars)));
        setScriptTargetChars(n);
        setScriptTargetCharsInput(String(n));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PODCAST_REUSE_TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        text?: string;
        script_target_chars?: number;
        script_language?: string;
        output_mode?: string;
        reference_urls?: string;
        intro_text?: string;
        outro_text?: string;
      };
      const txt = String(parsed.text || "").trim();
      if (txt) setText(txt);
      const chars = Number(parsed.script_target_chars || 0);
      if (Number.isFinite(chars) && chars >= 200 && chars <= 50000) {
        setScriptTargetChars(Math.round(chars));
        setScriptTargetCharsInput(String(Math.round(chars)));
      }
      const lang = String(parsed.script_language || "").trim();
      if (lang) setScriptLanguage(lang);
      const mode = String(parsed.output_mode || "").trim();
      setSpeakerMode(mode === "article" ? "single" : "dual");
      setReferenceUrlsBlock(String(parsed.reference_urls || "").trim());
      setIntroText(String(parsed.intro_text || "").trim());
      setOutroText(String(parsed.outro_text || "").trim());
      sessionStorage.removeItem(PODCAST_REUSE_TEMPLATE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PARTIAL_REDO_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        sourceJobId?: string;
        text?: string;
        prompt?: string;
        scope?: "full" | "intro" | "middle" | "outro";
      };
      const base = String(parsed.text || "").trim();
      const prompt = String(parsed.prompt || "").trim();
      const scope = String(parsed.scope || "full").trim();
      const scopeLabel =
        scope === "intro" ? "开场段落" : scope === "middle" ? "中段内容" : scope === "outro" ? "结尾段落" : "全文";
      if (base) {
        const defaultPrompt = `请仅重做${scopeLabel}，并尽量保留其他段落的结构、事实和顺序不变。`;
        const finalPrompt = prompt || defaultPrompt;
        const stitched = `请基于以下原文进行局部重做。\n重做范围：${scopeLabel}\n重做要求：${finalPrompt}\n\n原文：\n${base}`;
        setText(stitched);
        setTaskPhase(`已载入局部重做内容（${scopeLabel}），可直接调整后开始生成`);
        setPartialRedoMeta({
          sourceJobId: String(parsed.sourceJobId || "").trim() || undefined,
          scopeLabel,
          prompt: finalPrompt
        });
      }
      sessionStorage.removeItem(PARTIAL_REDO_KEY);
    } catch {
      // ignore
    }
  }, []);

  function clearPartialRedoContext() {
    setPartialRedoMeta(null);
    setTaskPhase("已清除局部重做上下文");
    try {
      sessionStorage.removeItem(PARTIAL_REDO_KEY);
    } catch {
      // ignore
    }
  }

  const buildIntroOutroSnapshotNow = useCallback(
    () =>
      buildIntroOutroSnapshot({
        introText,
        outroText,
        introVoiceFollow,
        introVoiceKey,
        outroVoiceFollow,
        outroVoiceKey,
        introBgm1Mode,
        introBgm2Mode,
        outroBgm3Mode,
        introBgm1File,
        introBgm2File,
        outroBgm3File,
        introBgm1StoredHex,
        introBgm2StoredHex,
        outroBgm3StoredHex
      }),
    [
      introText,
      outroText,
      introVoiceFollow,
      introVoiceKey,
      outroVoiceFollow,
      outroVoiceKey,
      introBgm1Mode,
      introBgm2Mode,
      outroBgm3Mode,
      introBgm1File,
      introBgm2File,
      outroBgm3File,
      introBgm1StoredHex,
      introBgm2StoredHex,
      outroBgm3StoredHex
    ]
  );

  useEffect(() => {
    if (!introOutroHydrated) return;
    const timer = window.setTimeout(() => {
      void buildIntroOutroSnapshotNow().then((snap) => writeLastIntroOutro("podcast", snap));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [introOutroHydrated, buildIntroOutroSnapshotNow]);

  const mergedDefaultVoices = useMemo((): Record<string, Record<string, unknown>> => {
    const out: Record<string, Record<string, unknown>> = { ...PODCAST_PRESET_VOICES };
    for (const [k, v] of Object.entries(defaultVoicesMap)) {
      if (!v || typeof v !== "object") continue;
      const base = (out[k] || {}) as Record<string, unknown>;
      const incoming = v as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base, ...incoming };
      const rawVid = String(incoming.voice_id ?? incoming.voiceId ?? "").trim();
      if ((k === "mini" || k === "max") && rawVid.startsWith("male-qn-")) {
        const want = String(PODCAST_PRESET_VOICES[k]?.voice_id ?? "").trim();
        if (want.startsWith("moss_audio_")) merged.voice_id = want;
      } else if (!merged.voice_id && typeof incoming.voiceId === "string" && incoming.voiceId.trim()) {
        merged.voice_id = incoming.voiceId.trim();
      }
      out[k] = merged;
    }
    return out;
  }, [defaultVoicesMap]);

  const voiceOptions = useMemo(
    () => buildVoiceOptionsFromMaps(mergedDefaultVoices, savedCustomVoices),
    [mergedDefaultVoices, savedCustomVoices]
  );

  const notebookChoices = useMemo(() => {
    const s = new Set<string>();
    notesList.forEach((n) => {
      const nb = (n.notebook || "").trim();
      if (nb) s.add(nb);
    });
    return ["全部", ...Array.from(s).sort((a, b) => a.localeCompare(b, "zh-CN"))];
  }, [notesList]);

  const filteredNotesForLibrary = useMemo(() => {
    if (notebookFilter === "全部") return notesList;
    return notesList.filter((n) => (n.notebook || "").trim() === notebookFilter);
  }, [notesList, notebookFilter]);

  const voiceIdSingle = useMemo(() => resolveVoiceId(voiceOptions, voiceKey1), [voiceOptions, voiceKey1]);
  const voiceId1 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey1), [voiceOptions, voiceKey1]);
  const voiceId2 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey2), [voiceOptions, voiceKey2]);

  const outputMode = speakerMode === "single" ? "article" : "dialogue";

  const fetchPodcastWorks = useCallback(async () => {
    setWorksError("");
    try {
      const res = await fetch("/api/works", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        ai?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
      setWorks(Array.isArray(data.ai) ? data.ai : []);
    } catch (e) {
      setWorksError(String(e instanceof Error ? e.message : e));
      setWorks([]);
    } finally {
      setWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void fetchPodcastWorks();
  }, [fetchPodcastWorks]);

  useEffect(() => {
    void (async () => {
      try {
        const [d, s, n, nb] = await Promise.all([
          fetch("/api/default-voices", { cache: "no-store", headers: { ...getAuthHeaders() } }),
          fetch("/api/saved_voices", { cache: "no-store", headers: { ...getAuthHeaders() } }),
          fetch("/api/notes", { cache: "no-store", headers: { ...getAuthHeaders() } }),
          fetch("/api/notebooks", { cache: "no-store", credentials: "same-origin", headers: { ...getAuthHeaders() } })
        ]);
        const dd = (await d.json().catch(() => ({}))) as { voices?: Record<string, Record<string, unknown>> };
        const sd = (await s.json().catch(() => ({}))) as { voices?: { voiceId: string; displayName?: string }[] };
        const nd = (await n.json().catch(() => ({}))) as { success?: boolean; notes?: { noteId: string; title?: string; notebook?: string }[] };
        const nbd = (await nb.json().catch(() => ({}))) as { success?: boolean; notebooks?: string[] };
        if (dd.voices) setDefaultVoicesMap(dd.voices);
        if (Array.isArray(sd.voices)) setSavedCustomVoices(sd.voices);
        if (n.ok && nd.success && Array.isArray(nd.notes)) setNotesList(nd.notes.slice(0, 300));
        if (nb.ok && nbd.success && Array.isArray(nbd.notebooks)) setStudioNotebooks(nbd.notebooks);
      } catch {
        // ignore
      }
    })();
  }, [getAuthHeaders]);

  useEffect(() => {
    if (introVoiceFollow) setIntroVoiceKey(voiceKey1);
  }, [voiceKey1, introVoiceFollow]);

  useEffect(() => {
    if (outroVoiceFollow) setOutroVoiceKey(voiceKey1);
  }, [voiceKey1, outroVoiceFollow]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** /podcast?applyCreative=usr:xxx|sys:xxx：从创作模板页一键跳转并打开加入创意 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const raw = u.searchParams.get("applyCreative");
    if (!raw) return;
    if (creativeBundleFromTemplateValue(raw)) {
      setCreativeTemplateValue(raw.trim());
      setActivePanel("creative");
    }
    u.searchParams.delete("applyCreative");
    const qs = u.searchParams.toString();
    window.history.replaceState({}, "", `${u.pathname}${qs ? `?${qs}` : ""}${u.hash}`);
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-podcast-panel]") || t.closest("[data-floating-panel]")) return;
      if (t.closest("[data-podcast-toolbar-chip]")) return;
      if (t.closest("[data-podcast-toolbar-gen]")) return;
      setActivePanel(null);
    }
    if (activePanel) {
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
    }
  }, [activePanel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePanel(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (logSuccessHideTimerRef.current) clearTimeout(logSuccessHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (recoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("podcast");
    if (!sid) return;
    recoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<
          string,
          unknown
        >;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("podcast");
          void fetchPodcastWorks();
          return;
        }
        if (st === "queued" || st === "running") {
          cancelledRef.current = false;
          setBusy(true);
          setTaskProgressPct(5);
          applyTaskFromEvent("检测到未完成的生成，继续监听…", 5);
          rememberJobId(sid);
          activeJobIdRef.current = sid;
          await waitJobEvents(sid);
          if (!cancelledRef.current) await finalizeJob(sid);
        }
      } catch {
        clearActiveGenerationJob("podcast");
      } finally {
        clearActiveGenerationJob("podcast");
        setBusy(false);
        cancelledRef.current = false;
      }
    })();
  }, [getAuthHeaders]);

  useEffect(() => {
    setSelectedNoteIds((prev) => {
      const cap = Math.min(noteRefCap, LIBRARY_MAX_SELECTED_NOTES);
      return prev.length > cap ? prev.slice(0, cap) : prev;
    });
  }, [noteRefCap]);

  useEffect(() => {
    setScriptTargetCharsInput(String(scriptTargetChars));
  }, [scriptTargetChars]);

  function selectNote(id: string) {
    setSelectedNoteIds((prev) => {
      if (prev[0] === id) return [];
      return [id];
    });
  }

  function commitScriptTargetCharsInput() {
    const parsed = Number(scriptTargetCharsInput);
    if (Number.isNaN(parsed)) {
      setScriptTargetCharsInput(String(scriptTargetChars));
      return;
    }
    const clamped = Math.min(50000, Math.max(200, Math.round(parsed)));
    setScriptTargetChars(clamped);
    setScriptTargetCharsInput(String(clamped));
  }

  function applyTaskFromEvent(message: string, progressFromPayload?: number) {
    setTaskPhase(message);
    if (typeof progressFromPayload === "number" && !Number.isNaN(progressFromPayload)) {
      setTaskProgressPct(Math.min(100, Math.max(0, progressFromPayload)));
    }
  }

  function waitJobEvents(jobId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      resolveWaitRef.current = resolve;
      const es = new EventSource(jobEventsSourceUrl(jobId, 0));
      eventSourceRef.current = es;
      activeJobIdRef.current = jobId;
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            status?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") {
            es.close();
            eventSourceRef.current = null;
            resolveWaitRef.current = null;
            resolve();
            return;
          }
          const msg = String(data.message || "").trim();
          const p = data.payload?.progress;
          if (msg) applyTaskFromEvent(msg, typeof p === "number" ? p : undefined);
          else if (typeof p === "number") setTaskProgressPct(Math.min(100, Math.max(0, p)));
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        applyTaskFromEvent("连接中断，正在重试或结束…");
        es.close();
        eventSourceRef.current = null;
        resolveWaitRef.current = null;
        resolve();
      };
    });
  }

  async function stopGeneration() {
    if (logSuccessHideTimerRef.current) {
      clearTimeout(logSuccessHideTimerRef.current);
      logSuccessHideTimerRef.current = null;
    }
    const jobId = activeJobIdRef.current;
    cancelledRef.current = true;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    resolveWaitRef.current?.();
    resolveWaitRef.current = null;
    activeJobIdRef.current = null;
    if (jobId) {
      try {
        await cancelJob(jobId);
        applyTaskFromEvent("已发送取消请求");
        await finalizeJob(jobId);
      } catch (e) {
        applyTaskFromEvent(`取消: ${String(e)}`);
      }
    }
    clearActiveGenerationJob("podcast");
    setBusy(false);
  }

  function refPayloadMinimal() {
    const { urlListText } = refsFromUrlBlock(referenceUrlsBlock);
    return buildReferenceJobFields({
      urlListText,
      selectedNoteIds,
      referenceExtra: "",
      useRag: false,
      ragMaxChars: 8000,
      referenceRagMode: "truncate"
    });
  }

  async function buildPodcastPayload(scriptCharsForJob: number) {
    const { url } = refsFromUrlBlock(referenceUrlsBlock);
    const b1 = await bgmSegmentPayloadFromState(introBgm1Mode, introBgm1File, introBgm1StoredHex);
    const b2 = await bgmSegmentPayloadFromState(introBgm2Mode, introBgm2File, introBgm2StoredHex);
    const b3 = await bgmSegmentPayloadFromState(outroBgm3Mode, outroBgm3File, outroBgm3StoredHex);
    const ttsExtras: Record<string, unknown> = {};
    if (b1.slot) ttsExtras.intro_bgm1_slot = b1.slot;
    if (b1.mp3_hex) ttsExtras.intro_bgm1_mp3_hex = b1.mp3_hex;
    if (b2.slot) ttsExtras.intro_bgm2_slot = b2.slot;
    if (b2.mp3_hex) ttsExtras.intro_bgm2_mp3_hex = b2.mp3_hex;
    if (b3.slot) ttsExtras.outro_bgm3_slot = b3.slot;
    if (b3.mp3_hex) ttsExtras.outro_bgm3_mp3_hex = b3.mp3_hex;
    if (!introVoiceFollow) ttsExtras.intro_voice_id = resolveVoiceId(voiceOptions, introVoiceKey);
    if (!outroVoiceFollow) ttsExtras.outro_voice_id = resolveVoiceId(voiceOptions, outroVoiceKey);

    const vMain = speakerMode === "single" ? voiceIdSingle : voiceId1;
    const v1 = voiceId1;
    const v2 = voiceId2;
    return buildScriptPayload(
      { text, url: url || undefined },
      {
        scriptTargetChars: scriptCharsForJob,
        scriptStyle: creativeBundle.scriptStyle,
        scriptLanguage,
        programName: DEFAULT_PROGRAM_NAME,
        speaker1Persona: creativeBundle.speaker1Persona,
        speaker2Persona: creativeBundle.speaker2Persona,
        scriptConstraints: creativeBundle.scriptConstraints,
        generateCover,
        ref: refPayloadMinimal(),
        outputMode,
        voiceId: vMain,
        voiceId1: v1,
        voiceId2: v2,
        introText,
        outroText,
        aiPolish: false,
        ttsExtras
      }
    );
  }

  async function ensureDefaultStudioNotebook(): Promise<string | null> {
    if (studioNotebooks.includes(DEFAULT_INGEST_NOTEBOOK_NAME)) return DEFAULT_INGEST_NOTEBOOK_NAME;
    const name = DEFAULT_INGEST_NOTEBOOK_NAME;
    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string; error?: string };
      if (!res.ok || !data.success) {
        const again = await fetch("/api/notebooks", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { ...getAuthHeaders() }
        });
        const ad = (await again.json().catch(() => ({}))) as { success?: boolean; notebooks?: string[] };
        if (again.ok && ad.success && Array.isArray(ad.notebooks) && ad.notebooks.length) {
          setStudioNotebooks(ad.notebooks);
          return ad.notebooks.includes(name) ? name : ad.notebooks[0]!;
        }
        applyTaskFromEvent(
          typeof data.detail === "string" ? data.detail : data.error || "无法自动创建资料笔记本"
        );
        return null;
      }
      const nb = await fetch("/api/notebooks", { cache: "no-store", credentials: "same-origin", headers: { ...getAuthHeaders() } });
      const nbd = (await nb.json().catch(() => ({}))) as { success?: boolean; notebooks?: string[] };
      if (nb.ok && nbd.success && Array.isArray(nbd.notebooks)) {
        setStudioNotebooks(nbd.notebooks);
        return name;
      }
      setStudioNotebooks((prev) => (prev.includes(name) ? prev : [name, ...prev]));
      return name;
    } catch (e) {
      applyTaskFromEvent(String(e instanceof Error ? e.message : e));
      return null;
    }
  }

  async function uploadNoteFile(file: File | null) {
    if (!file) return;
    const targetNb = (await ensureDefaultStudioNotebook())?.trim() || "";
    if (!targetNb) {
      applyTaskFromEvent("请先在「知识库」侧栏新建笔记本，或稍后重试上传");
      return;
    }
    setUploadBusy(true);
    setUploadProgress(0);
    try {
      const r = await uploadNoteFileWithProgress(file, {
        notebook: targetNb,
        title: file.name,
        projectName: NOTES_PODCAST_PROJECT_NAME,
        onProgress: (p) => setUploadProgress(p)
      });
      if (r.ok) {
        applyTaskFromEvent("资料文件已上传", undefined);
        const j = r.data;
        const nid = String(j.note?.noteId || "").trim();
        const n = await fetch("/api/notes", { cache: "no-store", headers: { ...getAuthHeaders() } }).then((x) =>
          x.json()
        );
        const nd = n as { success?: boolean; notes?: { noteId: string; title?: string; notebook?: string }[] };
        if (nd.success && Array.isArray(nd.notes)) {
          setNotesList(nd.notes.slice(0, 300));
        }
        // 单选：仅引用本次上传生成的笔记，覆盖此前在列表中勾选或更早一次上传的笔记
        setSelectedNoteIds(nid ? [nid] : []);
      } else {
        applyTaskFromEvent(`上传失败: ${r.error}`);
      }
    } catch (e) {
      applyTaskFromEvent(`上传错误: ${String(e)}`);
    } finally {
      setUploadBusy(false);
      setUploadProgress(null);
    }
  }

  async function finalizeJob(jobId: string): Promise<boolean> {
    try {
      const terminal = (await fetch(`/api/jobs/${jobId}`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      }).then((r) => r.json())) as Record<
        string,
        unknown
      >;
      const status = String(terminal.status || "");
      const err = String(terminal.error_message || "");
      const succeeded = status === "succeeded";
      if (succeeded) applyTaskFromEvent("生成完成", 100);
      else applyTaskFromEvent(err || "生成未成功");
      void fetchPodcastWorks();
      if (!showGallery && succeeded) onExternalListRefresh?.();
      return succeeded;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      applyTaskFromEvent(msg);
      void fetchPodcastWorks();
      return false;
    }
  }

  async function runPodcast() {
    const trimmed = text.trim();
    if (!trimmed) {
      applyTaskFromEvent("请先输入内容，再开始生成");
      return;
    }
    cancelledRef.current = false;
    if (logSuccessHideTimerRef.current) {
      clearTimeout(logSuccessHideTimerRef.current);
      logSuccessHideTimerRef.current = null;
    }
    setBusy(true);
    setTaskProgressPct(0);
      applyTaskFromEvent("正在为你排队…", 2);
    try {
      const effectiveChars = resolveScriptTargetCharsForJob(scriptTargetChars, scriptTargetCharsInput);
      setScriptTargetChars(effectiveChars);
      setScriptTargetCharsInput(String(effectiveChars));
      const payload = await buildPodcastPayload(effectiveChars);
      try {
        const prev = await previewMediaJob({
          project_name: "web-podcast-native",
          job_type: "podcast_generate",
          queue_name: "media",
          payload,
          ...(createdByPhone ? { created_by: createdByPhone } : {})
        });
        if (prev.summary && prev.allowed !== false) {
          applyTaskFromEvent(prev.summary, 3);
        }
        if (prev.allowed === false) {
          applyTaskFromEvent(prev.detail || "余额或套餐不足，请前往订阅与订单处理");
          return;
        }
      } catch (pe) {
        applyTaskFromEvent(String(pe instanceof Error ? pe.message : pe));
        return;
      }
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          project_name: "web-podcast-native",
          job_type: "podcast_generate",
          queue_name: "media",
          payload,
          ...(createdByPhone ? { created_by: createdByPhone } : {})
        })
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        applyTaskFromEvent(formatOrchestratorErrorText(errText) || `创建失败: HTTP ${createRes.status}`);
        return;
      }
      const created = (await createRes.json().catch(() => ({}))) as { id?: string };
      const jobId = String(created.id || "").trim();
      if (!jobId) {
        applyTaskFromEvent("创建失败: 缺少记录编号");
        return;
      }
      applyTaskFromEvent("已提交，生成即将开始…", 5);
      rememberJobId(jobId);
      setActiveGenerationJob("podcast", jobId);
      setActivePanel(null);

      await waitJobEvents(jobId);
      if (!cancelledRef.current) {
        const ok = await finalizeJob(jobId);
        if (ok && !cancelledRef.current) {
          if (logSuccessHideTimerRef.current) clearTimeout(logSuccessHideTimerRef.current);
          logSuccessHideTimerRef.current = setTimeout(() => {
            setTaskPhase("");
            setTaskProgressPct(0);
            logSuccessHideTimerRef.current = null;
          }, 5000);
        }
      }
    } catch (err) {
      applyTaskFromEvent(`生成失败：${String(err)}`);
    } finally {
      clearActiveGenerationJob("podcast");
      if (!cancelledRef.current) setBusy(false);
      cancelledRef.current = false;
    }
  }

  const durationLabel = DURATION_PRESETS.find((p) => p.chars === scriptTargetChars)?.label ?? "自定义";
  const durationPresetHighlight = durationInputMatchesCommitted(scriptTargetChars, scriptTargetCharsInput);
  const voiceSummary =
    speakerMode === "single"
      ? voiceOptions.find((v) => v.key === voiceKey1)?.name ?? "音色"
      : `${voiceOptions.find((v) => v.key === voiceKey1)?.name ?? "1"}·${voiceOptions.find((v) => v.key === voiceKey2)?.name ?? "2"}`;
  const introSummary =
    introText.trim() ||
    outroText.trim() ||
    introBgm1Mode !== "none" ||
    introBgm2Mode !== "none" ||
    outroBgm3Mode !== "none" ||
    !introVoiceFollow ||
    !outroVoiceFollow
      ? "已设"
      : "未设";
  const creativeSummary = formatCreativeTemplateChip(creativeTemplateValue);
  const refUrlLines = referenceUrlsBlock.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const librarySummary =
    refUrlLines.length > 0 || selectedNoteIds.length > 0
      ? `链接${refUrlLines.length}·笔记${selectedNoteIds.length ? "1" : "0"}`
      : "未选资料";

  useEffect(() => {
    const lines = referenceUrlsBlock.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const parts: string[] = [];
    if (lines.length) parts.push(`链接 ${lines.length} 条`);
    if (selectedNoteIds.length) {
      const id0 = selectedNoteIds[0];
      const title = id0 ? notesList.find((n) => n.noteId === id0)?.title || id0 : "";
      if (title) parts.push(`笔记：${title}`);
    }
    onLibrarySelectionPreviewChange?.(parts.join(" · "));
  }, [referenceUrlsBlock, selectedNoteIds, notesList, onLibrarySelectionPreviewChange]);

  const showTaskPanel = busy || taskPhase.length > 0;

  const etaMinutesRemaining = useMemo(() => {
    if (!busy && taskProgressPct >= 100) return 0;
    const totalMin = Math.max(5, Math.min(48, Math.round(5 + scriptTargetChars / 420)));
    if (taskProgressPct <= 0) return totalMin;
    return Math.max(1, Math.ceil(((100 - taskProgressPct) / 100) * totalMin));
  }, [busy, taskProgressPct, scriptTargetChars]);

  const panelClassAnchor =
    "z-[360] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-2.5 shadow-card sm:p-3";
  const panelClassIntroAnchor =
    "z-[360] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-3 shadow-card sm:p-4";
  const panelClassAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-2.5 shadow-card sm:p-3 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(52dvh,300px)]";
  const panelClassIntroAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-3 shadow-card sm:p-4 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(68dvh,520px)]";
  const renderFloatingPanel = useCallback(
    (panelId: Exclude<PanelId, null>, mobileClass: string, desktopClass: string, ariaLabel: string, children: ReactNode) => {
      if (activePanel !== panelId) return null;
      const anchorEl =
        typeof document === "undefined"
          ? null
          : (() => {
              const node = document.querySelector(`[data-podcast-toolbar-chip-id="${panelId}"]`);
              return node instanceof HTMLElement ? node : null;
            })();
      return (
        <FloatingPopover
          open={activePanel === panelId}
          anchorEl={anchorEl}
          isMobile={isMobileViewport}
          mobileClassName={mobileClass}
          desktopClassName={desktopClass}
          ariaLabel={ariaLabel}
          onMouseDown={stopPanelPointer}
        >
          {children}
        </FloatingPopover>
      );
    },
    [activePanel, isMobileViewport, stopPanelPointer]
  );

  useEffect(() => {
    onActivityChange?.({ busy, phase: taskPhase, progressPct: taskProgressPct });
  }, [busy, taskPhase, taskProgressPct, onActivityChange]);

  useImperativeHandle(
    ref,
    () => ({
      generate: () => {
        void runPodcast();
      },
      stop: () => {
        void stopGeneration();
      }
    }),
    [runPodcast, stopGeneration]
  );

  const Root = embedded ? "div" : "main";
  const rootClass = embedded ? "min-w-0 flex-1" : "mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4";
  const nestCard = !(embedded && blendOuterCard);
  const shellClass = nestCard
    ? "relative overflow-visible rounded-2xl border border-line bg-surface shadow-soft"
    : "relative overflow-visible";
  const innerPad = nestCard ? "p-4 md:p-5" : "p-0";

  return (
    <Root className={rootClass}>
      {!embedded ? (
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">开始生成播客</h1>
          <p className="mt-2 text-sm text-muted">3 步完成：输入内容 → 风格 → 开始生成</p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-muted">
            首次使用可先填<strong className="text-ink">较短提纲或试稿</strong>跑通流程，满意后再换长内容；生成中可在「我的作品 → 进行中」查看进度。
          </p>
        </div>
      ) : null}

      <section className={shellClass}>
        <div className={`flex min-h-0 flex-col ${innerPad}`}>
          {partialRedoMeta ? (
            <div className="mb-3 rounded-lg border border-line bg-fill/70 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">局部重做上下文</p>
                <button
                  type="button"
                  className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-fill"
                  onClick={clearPartialRedoContext}
                >
                  清除重做上下文
                </button>
              </div>
              <p className="mt-1 text-muted">
                范围：{partialRedoMeta.scopeLabel}
                {partialRedoMeta.sourceJobId ? ` · 来源任务：${partialRedoMeta.sourceJobId.slice(0, 8)}…` : ""}
              </p>
              <p className="mt-1 line-clamp-2 text-muted" title={partialRedoMeta.prompt}>
                提示：{partialRedoMeta.prompt}
              </p>
            </div>
          ) : null}
          {!embedded ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-brand/10 px-2 py-1 font-medium text-brand">第 1 步 输入内容</span>
              <span className="rounded-full bg-fill px-2 py-1 text-muted">第 2 步 风格</span>
              <span className="rounded-full bg-fill px-2 py-1 text-muted">第 3 步 开始生成</span>
            </div>
          ) : null}
          {controlledText === undefined ? (
            <textarea
              className="min-h-[min(22vh,140px)] w-full max-w-none resize-y rounded-xl border border-line bg-fill p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 md:min-h-[150px]"
              placeholder={MAIN_TEXT_PLACEHOLDER}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : null}

          {/* 选项条 + 生成按钮（同一行，按钮在最右） */}
          <div className={controlledText === undefined ? "relative mt-4 border-t border-line pt-3" : "relative border-t border-line pt-3"}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="mode" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "mode")} onClick={() => setActivePanel((p) => (p === "mode" ? null : "mode"))}>
                      {speakerMode === "dual" ? "双人" : "单人"}
                    </button>
                    {renderFloatingPanel(
                      "mode",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "单人或双人",
                      <>
                        <p className="mb-3 text-sm font-medium text-ink">单人 / 双人</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`rounded-lg px-4 py-2 text-sm ${speakerMode === "single" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                            onClick={() => setSpeakerMode("single")}
                          >
                            单人
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-4 py-2 text-sm ${speakerMode === "dual" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                            onClick={() => setSpeakerMode("dual")}
                          >
                            双人
                          </button>
                        </div>
                      </>
                    )}
                  </span>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="lang" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "lang")} onClick={() => setActivePanel((p) => (p === "lang" ? null : "lang"))}>
                      语言 · {scriptLanguage}
                    </button>
                    {renderFloatingPanel(
                      "lang",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "语言",
                      <>
                        <p className="mb-2 text-sm font-medium">语言</p>
                        <div className="flex flex-wrap gap-2">
                          {LANG_OPTIONS.map((l) => (
                            <button
                              key={l}
                              type="button"
                              className={`rounded-lg px-3 py-1.5 text-sm ${scriptLanguage === l ? "bg-brand text-brand-foreground" : "border border-line"}`}
                              onClick={() => setScriptLanguage(l)}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </span>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="creative" className="relative inline-block align-top">
                    <button
                      type="button"
                      className={chipClass(activePanel === "creative")}
                      title={CREATIVE_CHIP_HOVER_HINT}
                      onClick={() => setActivePanel((p) => (p === "creative" ? null : "creative"))}
                    >
                      风格 · {creativeSummary}
                    </button>
                    {renderFloatingPanel(
                      "creative",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "加入创意",
                      <CreativeTemplatePicker value={creativeTemplateValue} onChange={setCreativeTemplateValue} />
                    )}
                  </span>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="library" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "library")} onClick={() => setActivePanel((p) => (p === "library" ? null : "library"))}>
                      资料库 · {librarySummary}
                    </button>
                    {renderFloatingPanel(
                      "library",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "资料库",
                      <div className="flex flex-col gap-2">
                        <PlanTierHint variant="notes_ref" />
                        <div className="rounded-lg border border-line bg-fill/70 p-2.5">
                          <p className="mb-1.5 text-xs font-medium text-ink">网页链接</p>
                          <textarea
                            className="max-h-[4.5rem] w-full max-w-[min(100%,66%)] rounded-lg border border-line bg-surface p-2 font-mono text-sm leading-snug text-ink placeholder:text-muted"
                            rows={2}
                            value={referenceUrlsBlock}
                            onChange={(e) => setReferenceUrlsBlock(e.target.value)}
                            placeholder=""
                          />
                        </div>
                        <div className="flex flex-col rounded-lg border border-line bg-fill/70 p-2.5">
                          <p className="mb-1.5 text-xs font-medium text-ink">本地上传</p>
                          <input
                            ref={uploadInputRef}
                            type="file"
                            accept=".txt,.md,.markdown,.pdf,.doc,.docx,.epub"
                            className="hidden"
                            onChange={(e) => void uploadNoteFile(e.target.files?.[0] || null)}
                            disabled={uploadBusy}
                          />
                          <button
                            type="button"
                            className="w-full rounded-lg border border-line bg-surface py-2 text-sm font-medium text-ink hover:bg-fill disabled:opacity-50"
                            disabled={uploadBusy}
                            title={uploadBusy ? "上传过程中请稍候" : undefined}
                            onClick={() => uploadInputRef.current?.click()}
                          >
                            {uploadBusy
                              ? uploadProgress != null && uploadProgress < 100
                                ? `上传中 ${uploadProgress}%`
                                : "处理中…"
                              : "上传资料"}
                          </button>
                          {uploadBusy && uploadProgress != null ? (
                            <div className="mt-2 space-y-1">
                              <div
                                className="h-1.5 w-full overflow-hidden rounded-full bg-track"
                                role="progressbar"
                                aria-valuenow={uploadProgress}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
                                <div className="h-full bg-brand transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                              </div>
                              <p className="text-xs text-muted">
                                {uploadProgress < 100 ? "正在上传…" : "正在解析与保存…"}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="rounded-lg border border-line bg-fill/70 p-2.5">
                          <p className="mb-1.5 text-xs font-medium text-ink">笔记选择</p>
                          <select
                            className="mb-1.5 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink"
                            value={notebookFilter}
                            onChange={(e) => setNotebookFilter(e.target.value)}
                          >
                            {notebookChoices.map((nb) => (
                              <option key={nb} value={nb}>
                                {nb}
                              </option>
                            ))}
                          </select>
                          <p className="mb-1 text-xs text-muted">单选 1 本笔记（生成时作为资料引用）</p>
                          <div className="max-h-[5.5rem] overflow-auto text-sm text-ink">
                            {filteredNotesForLibrary.length === 0 ? <span className="text-muted">无</span> : null}
                            {filteredNotesForLibrary.map((n) => (
                              <label key={n.noteId} className="flex cursor-pointer gap-2 py-0.5">
                                <input
                                  type="checkbox"
                                  className="mt-1 shrink-0"
                                  checked={selectedNoteIds[0] === n.noteId}
                                  onChange={() => selectNote(n.noteId)}
                                />
                                <span className="min-w-0 truncate leading-snug">{n.title || n.noteId}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </span>
                  <button
                    type="button"
                    className={chipClass(showAdvanced)}
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? "收起高级设置" : "展开高级设置"}
                  </button>
                  {showAdvanced ? (
                    <>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="voice" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "voice")} onClick={() => setActivePanel((p) => (p === "voice" ? null : "voice"))}>
                      音色 · {voiceSummary}
                    </button>
                    {renderFloatingPanel(
                      "voice",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "音色设置",
                      <>
                        <p className="mb-1 text-sm font-medium">音色</p>
                        {voiceOptions.length === 0 ? (
                          <p className="text-xs text-warning-ink">加载音色中…</p>
                        ) : null}
                        {speakerMode === "single" ? (
                          <label className="block text-xs">
                            主音色
                            <VoiceSelect voiceOptions={voiceOptions} value={voiceKey1} onChange={setVoiceKey1} />
                          </label>
                        ) : (
                          <div className="space-y-2">
                            <label className="block text-xs">
                              Speaker1
                              <VoiceSelect voiceOptions={voiceOptions} value={voiceKey1} onChange={setVoiceKey1} />
                            </label>
                            <label className="block text-xs">
                              Speaker2
                              <VoiceSelect voiceOptions={voiceOptions} value={voiceKey2} onChange={setVoiceKey2} />
                            </label>
                          </div>
                        )}
                      </>
                    )}
                  </span>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="duration" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "duration")} onClick={() => setActivePanel((p) => (p === "duration" ? null : "duration"))}>
                      时长 · {durationLabel}
                    </button>
                    {renderFloatingPanel(
                      "duration",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "时长",
                      <>
                        <p className="mb-2 text-sm font-medium">时长</p>
                        <div className="flex flex-wrap gap-2">
                          {DURATION_PRESETS.map((p) => (
                            <button
                              key={p.chars}
                              type="button"
                              className={`rounded-lg border px-3 py-2 text-left text-sm ${durationPresetHighlight && scriptTargetChars === p.chars ? "border-brand bg-fill" : "border-line"}`}
                              onClick={() => setScriptTargetChars(p.chars)}
                            >
                              {p.label}
                              <span className="block text-xs text-muted">{p.hint}</span>
                            </button>
                          ))}
                        </div>
                        <label className="mt-3 block text-xs">
                          <span>字数（200–50000，以套餐为准）</span>
                          <input
                            type="number"
                            min={200}
                            max={50000}
                            className="mt-1 w-full rounded-lg border border-line bg-surface p-2"
                            value={scriptTargetCharsInput}
                            onChange={(e) => setScriptTargetCharsInput(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={commitScriptTargetCharsInput}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitScriptTargetCharsInput();
                                setActivePanel(null);
                              }
                            }}
                          />
                        </label>
                      </>
                    )}
                  </span>
                  <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="intro" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "intro")} onClick={() => setActivePanel((p) => (p === "intro" ? null : "intro"))}>
                      开场/结尾 · {introSummary}
                    </button>
                    {renderFloatingPanel(
                      "intro",
                      panelClassIntroAnchorMobile,
                      panelClassIntroAnchor,
                      "开场与结尾",
                      <>
                        <p className="mb-1 text-sm font-medium">开场 / 结尾</p>
                        <p className="mb-3 text-xs text-muted">开场 / 正文 / 结尾与背景音均可选。</p>
                        <IntroOutroPresetBar
                          scope="podcast"
                          buildSnapshot={buildIntroOutroSnapshotNow}
                          onApplySnapshot={applyIntroOutroSnapshot}
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-xl border border-line bg-fill/80 p-4">
                            <h3 className="mb-3 text-sm font-semibold text-ink">开场设置</h3>
                            <BgmControlRow
                              label="背景音 1"
                              mode={introBgm1Mode}
                              onModeChange={(m) => {
                                setIntroBgm1Mode(m);
                                if (m !== "upload") setIntroBgm1StoredHex(null);
                              }}
                              file={introBgm1File}
                              onFileChange={(f) => {
                                setIntroBgm1File(f);
                                if (f) setIntroBgm1StoredHex(null);
                              }}
                              uploadRestoredHint={introBgm1Mode === "upload" && Boolean(introBgm1StoredHex && !introBgm1File)}
                            />
                            <label className="mt-3 block text-xs">
                              开场语
                              <textarea
                                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                rows={3}
                                value={introText}
                                onChange={(e) => setIntroText(e.target.value)}
                                placeholder="例如：欢迎收听本期节目（留空可跳过）"
                              />
                            </label>
                            <div className="mt-3 space-y-2">
                              <span className="text-xs font-medium text-ink">音色</span>
                              <select
                                className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                value={introVoiceFollow ? "follow" : "custom"}
                                onChange={(e) => setIntroVoiceFollow(e.target.value === "follow")}
                              >
                                <option value="follow">默认跟随 Speaker1</option>
                                <option value="custom">自定义</option>
                              </select>
                              {!introVoiceFollow ? <VoiceSelect voiceOptions={voiceOptions} value={introVoiceKey} onChange={setIntroVoiceKey} /> : null}
                            </div>
                            <div className="mt-3">
                              <BgmControlRow
                                label="背景音 2"
                                mode={introBgm2Mode}
                                onModeChange={(m) => {
                                  setIntroBgm2Mode(m);
                                  if (m !== "upload") setIntroBgm2StoredHex(null);
                                }}
                                file={introBgm2File}
                                onFileChange={(f) => {
                                  setIntroBgm2File(f);
                                  if (f) setIntroBgm2StoredHex(null);
                                }}
                                uploadRestoredHint={introBgm2Mode === "upload" && Boolean(introBgm2StoredHex && !introBgm2File)}
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border border-line bg-fill/80 p-4">
                            <h3 className="mb-3 text-sm font-semibold text-ink">结尾设置</h3>
                            <label className="block text-xs">
                              结尾语
                              <textarea
                                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                rows={3}
                                value={outroText}
                                onChange={(e) => setOutroText(e.target.value)}
                                placeholder="例如：感谢收听，我们下期再见（留空可跳过）"
                              />
                            </label>
                            <div className="mt-3 space-y-2">
                              <span className="text-xs font-medium text-ink">音色</span>
                              <select
                                className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                value={outroVoiceFollow ? "follow" : "custom"}
                                onChange={(e) => setOutroVoiceFollow(e.target.value === "follow")}
                              >
                                <option value="follow">默认跟随 Speaker1</option>
                                <option value="custom">自定义</option>
                              </select>
                              {!outroVoiceFollow ? <VoiceSelect voiceOptions={voiceOptions} value={outroVoiceKey} onChange={setOutroVoiceKey} /> : null}
                            </div>
                            <div className="mt-3">
                              <BgmControlRow
                                label="背景音 3"
                                mode={outroBgm3Mode}
                                onModeChange={(m) => {
                                  setOutroBgm3Mode(m);
                                  if (m !== "upload") setOutroBgm3StoredHex(null);
                                }}
                                file={outroBgm3File}
                                onFileChange={(f) => {
                                  setOutroBgm3File(f);
                                  if (f) setOutroBgm3StoredHex(null);
                                }}
                                uploadRestoredHint={outroBgm3Mode === "upload" && Boolean(outroBgm3StoredHex && !outroBgm3File)}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </span>
                    </>
                  ) : null}
                </div>
              </div>

              {!hideGenerateButton ? (
                <button
                  type="button"
                  data-podcast-toolbar-gen
                  onClick={() => {
                    if (busy) {
                      void stopGeneration();
                      return;
                    }
                    void runPodcast();
                  }}
                  className="inline-flex min-w-[6.25rem] shrink-0 items-center justify-center gap-2 self-end rounded-full bg-cta px-3 py-2 text-xs font-medium text-cta-foreground shadow-soft transition hover:scale-105 hover:bg-cta/90 sm:ml-1 sm:self-start"
                  aria-label={busy ? "停止生成" : "开始生成"}
                >
                  {busy ? <StopIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-4 w-4 translate-x-px" />}
                  <span>{busy ? "停止生成" : "开始生成"}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {!embedded ? (
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">快速示例</h2>
        <div className="flex flex-wrap gap-2">
          {LISTENHUB_CREATIVE_HINTS.map((p) => (
            <button
              key={p}
              type="button"
              className="rounded-full border border-line bg-fill px-3 py-1.5 text-left text-xs text-ink transition hover:border-brand/40 hover:bg-surface"
              onClick={() => setText(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </section>
      ) : null}

      {showGallery ? (
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">生成结果</h2>
        {showTaskPanel ? (
          <div className="mb-4 rounded-2xl border border-brand/25 bg-fill/90 p-4 shadow-soft">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">进行中</h3>
            <p className="mt-2 text-sm text-ink">{taskPhase || (busy ? "处理中…" : "—")}</p>
            <div className="mt-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, taskProgressPct))}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{taskProgressPct > 0 ? `${taskProgressPct}%` : busy ? "排队中" : ""}</span>
                <span>
                  {busy || taskProgressPct > 0
                    ? taskProgressPct >= 100
                      ? "已完成"
                      : `预估剩余约 ${etaMinutesRemaining} 分钟`
                    : ""}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <Link href="/jobs" className="font-medium text-brand hover:underline">
                任务详情
              </Link>
              <Link href="/works" className="font-medium text-brand hover:underline">
                我的作品
              </Link>
            </div>
          </div>
        ) : null}
        <PodcastWorksGallery
          works={works}
          loading={worksLoading}
          fetchError={worksError}
          onDismissError={() => setWorksError("")}
          onWorkDeleted={() => void fetchPodcastWorks()}
        />
      </section>
      ) : null}
    </Root>
  );
});

export default PodcastStudio;
