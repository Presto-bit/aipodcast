"use client";

import Link from "next/link";
import { Download, PanelRightClose, PanelRightOpen, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import type { ClipProjectRow, ClipSilenceSegment, ClipWord } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import {
  adjustPlaybackMsForExcluded,
  applyPlaybackPreRollBeforeNextKept,
  findPlaybackHighlightWordIndex,
  snapMsNearWordEdges
} from "../../lib/prestoFlowPlayback";
import {
  buildClipEditSuggestions,
  dedupeRoughCutEditSuggestions,
  mapLlmApiItemsToSuggestions,
  type ClipEditSuggestion,
  type ClipOutlineSource,
  type LlmSuggestionApiItem
} from "../../lib/prestoFlowAiSuggestions";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import {
  buildRoughCutExemptSet,
  collectSubstringMatchWordIds,
  collectVerbalTicWordIds,
  verbalTicRowDismissId
} from "../../lib/prestoFlowRoughCutLexicon";
import {
  buildFlowUnits,
  groupSpeakerSentenceLines,
  maxEndMsForLineContainingWordId,
  wordIdsBetweenInclusive
} from "../../lib/prestoFlowTranscript";
import type { ClipWaveformHandle } from "../clip/ClipWaveformPanel";
import AudioConsole from "./AudioConsole";
import ClipStagingTracksBar from "./ClipStagingTracksBar";
import ClipExportQcGateModal from "./ClipExportQcGateModal";
import ClipRepairPanel from "./ClipRepairPanel";
import ClipRoughCutPanel from "./ClipRoughCutPanel";
import ClipScriptSearchPanel from "./ClipScriptSearchPanel";
import PrestoFlowHeader from "./PrestoFlowHeader";
import PrestoFlowImportBar from "./PrestoFlowImportBar";
import VirtualizedTranscript, { type VirtualizedTranscriptHandle } from "./VirtualizedTranscript";

function isDualChannels(ch: unknown): boolean {
  return Array.isArray(ch) && ch.length >= 2;
}

type EngineHeaderState = "idle" | "queued" | "running" | "ready" | "failed";

function mapTranscriptionToEngine(st: string | undefined): EngineHeaderState {
  if (st === "queued" || st === "running") return st === "queued" ? "queued" : "running";
  if (st === "succeeded") return "ready";
  if (st === "failed") return "failed";
  return "idle";
}

function readRoughDismissedSet(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`presto-rough-dismiss:${projectId}`);
    const a = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(a) ? a.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Word 式「向前删除」：删除插入点左侧的上一块可见词（尚未标记删除） */
function findPrevUnexcludedWordId(
  words: readonly ClipWord[],
  fromId: string,
  excluded: ReadonlySet<string>
): string | null {
  const ix = words.findIndex((w) => w.id === fromId);
  if (ix < 1) return null;
  for (let j = ix - 1; j >= 0; j--) {
    const id = words[j]!.id;
    if (!excluded.has(id)) return id;
  }
  return null;
}

function initialWordMarkersFromSuggestions(
  sugs: readonly ClipEditSuggestion[]
): Record<string, { suggestionKey: string; status: "pending" }> {
  const m: Record<string, { suggestionKey: string; status: "pending" }> = {};
  for (const s of sugs) {
    const ex = s.execute;
    if (!ex || (ex.kind !== "excludeWords" && ex.kind !== "keepStutterFirst")) continue;
    for (const id of ex.wordIds) m[id] = { suggestionKey: s.id, status: "pending" };
  }
  return m;
}

function suggestionFeedbackPayload(
  s: ClipEditSuggestion,
  kind: "suggestion_apply" | "suggestion_undo"
): Record<string, unknown> {
  const ex = s.execute;
  const wordIds =
    ex && (ex.kind === "excludeWords" || ex.kind === "keepStutterFirst") ? ex.wordIds : [];
  return {
    kind,
    suggestion_id: s.llmSuggestionId || s.id,
    parent_suggestion_id: s.parentLlmSuggestionId,
    source: s.source,
    execute_kind: ex?.kind,
    word_ids: wordIds,
    title: s.title.slice(0, 120)
  };
}

export default function PrestoFlowEditor({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { getAuthHeaders } = useAuth();

  const [project, setProject] = useState<ClipProjectRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [focusedWordId, setFocusedWordId] = useState<string | null>(null);
  const [saveExcludedHint, setSaveExcludedHint] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [llmSugs, setLlmSugs] = useState<ClipEditSuggestion[]>([]);
  /** idle | outline | structured | expand */
  const [llmPhase, setLlmPhase] = useState<"idle" | "outline" | "structured" | "expand">("idle");
  const [silenceSegments, setSilenceSegments] = useState<ClipSilenceSegment[] | null>(null);
  /** 粗剪侧栏：不再展示的建议（口癖行 / 规则&AI / 长静音），按工程存 localStorage */
  const [dismissedRoughKeys, setDismissedRoughKeys] = useState<Set<string>>(() => new Set());
  /** 稿面词级标记：suggestionKey 对应 ClipEditSuggestion.id */
  const [wordMarkers, setWordMarkers] = useState<Record<string, { suggestionKey: string; status: "pending" | "applied" }>>(
    {}
  );
  /** 右侧工作台：默认收起以加宽稿面与音频区；可随时点开 */
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<"suggestions" | "engine" | "search">("suggestions");
  /** 侧栏「搜索」：稿面子串高亮与批量删词 */
  const [scriptSearch, setScriptSearch] = useState("");
  /** 稿面仅高亮当前搜索命中子集（默认首处；下一个 / 全选 / 点句子后更新） */
  const [searchHlWordIds, setSearchHlWordIds] = useState<Set<string>>(() => new Set());
  const [playbackRate, setPlaybackRate] = useState(1);
  /** 词链试听：与终版导出同 ffmpeg 算法，单独对象键；波形 URL 切换，稿面时间戳仍对原片 */
  const [wordchainPreviewOn, setWordchainPreviewOn] = useState(false);
  const [wordchainPreviewNonce, setWordchainPreviewNonce] = useState(0);
  const [wordchainPreviewBusy, setWordchainPreviewBusy] = useState(false);
  const [exportGateOpen, setExportGateOpen] = useState(false);
  const [exportGatePhase, setExportGatePhase] = useState<"idle" | "analyze" | "export">("idle");
  const [exportGateErr, setExportGateErr] = useState<string | null>(null);
  /** Shift+点击或「整句」选中的词 id，Delete 批量标记删除 */
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(() => new Set());
  /** 文稿区域全屏模式 */
  const [transcriptFullscreen, setTranscriptFullscreen] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformRef = useRef<ClipWaveformHandle | null>(null);
  const transcriptRef = useRef<VirtualizedTranscriptHandle | null>(null);
  /** 稿面滚动容器，拖选时用 elementsFromPoint 限定在稿面内 */
  const transcriptScrollElRef = useRef<HTMLDivElement | null>(null);
  /** 侧栏「搜索」Tab 内搜索框；⌘F / Ctrl+F 聚焦并打开该 Tab */
  const scriptSearchInputRef = useRef<HTMLInputElement | null>(null);
  /** Shift+选词范围锚点（最近一次非 Shift 点击的词 id） */
  const rangeAnchorWordIdRef = useRef<string | null>(null);
  /** 拖选结束后吞掉一次 click，避免误清多选 */
  const skipNextWordActivateRef = useRef(false);
  const rangeDragAnchorRef = useRef<string | null>(null);
  const rangeDragMovedRef = useRef(false);
  const excludedRef = useRef(excluded);
  /** 转写/导出轮询：隐藏标签页时暂停，减少无效全量拉工程 */
  const projectBusyPollVisibleRef = useRef(true);
  const excludedUndoStack = useRef<string[][]>([]);
  const excludedRedoStack = useRef<string[][]>([]);
  const [, bumpExcludedHistory] = useReducer((n: number) => n + 1, 0);
  const lastScrollWordId = useRef("");
  /** 口癖侧栏跳转试听：播放到当前稿面行末自动暂停 */
  const sentenceAutopauseEndMsRef = useRef<number | null>(null);

  useEffect(() => {
    excludedRef.current = excluded;
  }, [excluded]);

  useEffect(() => {
    const onVis = () => {
      projectBusyPollVisibleRef.current = document.visibilityState === "visible";
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    setMultiSelectIds(new Set());
    rangeAnchorWordIdRef.current = null;
  }, [projectId]);

  useEffect(() => {
    setScriptSearch("");
    setSearchHlWordIds(new Set());
  }, [projectId]);

  useEffect(() => {
    setWordchainPreviewOn(false);
    setWordchainPreviewNonce(0);
  }, [projectId]);

  useEffect(() => {
    if (!project?.export_pause_policy?.enabled) setWordchainPreviewOn(false);
  }, [project?.export_pause_policy?.enabled]);

  const words = useMemo(() => {
    const w = project?.transcript_normalized?.words;
    return Array.isArray(w) ? (w as ClipWord[]) : [];
  }, [project]);

  const roughCutExemptSet = useMemo(
    () => buildRoughCutExemptSet(project?.rough_cut_lexicon_exempt),
    [project?.rough_cut_lexicon_exempt]
  );

  const lines = useMemo(() => groupSpeakerSentenceLines(buildFlowUnits(words)), [words]);

  const scriptSearchHitIdsOrdered = useMemo(
    () => collectSubstringMatchWordIds(words, scriptSearch, excluded),
    [words, scriptSearch, excluded]
  );

  useEffect(() => {
    const q = scriptSearch.trim();
    if (!q) {
      setSearchHlWordIds(new Set());
      return;
    }
    const ids = collectSubstringMatchWordIds(words, scriptSearch, excluded);
    setSearchHlWordIds(ids.length ? new Set([ids[0]!]) : new Set());
  }, [scriptSearch, words, excluded]);

  const roughCutHighlightIds = useMemo(() => {
    const ticRaw = collectVerbalTicWordIds(words, excluded, roughCutExemptSet);
    const tic =
      dismissedRoughKeys.size === 0
        ? ticRaw
        : ticRaw.filter((id) => {
            const w = words.find((x) => x.id === id);
            if (!w) return true;
            const dk = verbalTicRowDismissId(w, roughCutExemptSet);
            return !dk || !dismissedRoughKeys.has(dk);
          });
    const q = scriptSearch.trim();
    if (!q) return new Set(tic);
    return new Set([...tic, ...searchHlWordIds]);
  }, [words, excluded, roughCutExemptSet, scriptSearch, searchHlWordIds, dismissedRoughKeys]);

  const searchAllHitsSelected = useMemo(() => {
    if (scriptSearchHitIdsOrdered.length === 0) return false;
    return scriptSearchHitIdsOrdered.every((id) => multiSelectIds.has(id));
  }, [scriptSearchHitIdsOrdered, multiSelectIds]);

  const allSearchHitsHighlighted = useMemo(() => {
    if (!scriptSearch.trim() || !scriptSearchHitIdsOrdered.length) return false;
    return scriptSearchHitIdsOrdered.every((id) => searchHlWordIds.has(id));
  }, [scriptSearch, scriptSearchHitIdsOrdered, searchHlWordIds]);

  const activeSearchHighlightWordId = useMemo(() => {
    if (searchHlWordIds.size !== 1) return null;
    return [...searchHlWordIds][0] ?? null;
  }, [searchHlWordIds]);

  const findWordIdUnderPoint = useCallback((clientX: number, clientY: number): string | null => {
    const root = transcriptScrollElRef.current;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    let stack: Element[];
    try {
      stack = [...document.elementsFromPoint(clientX, clientY)];
    } catch {
      return null;
    }
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (!root.contains(node)) continue;
      const el = node.closest("[data-word-id]");
      if (el) {
        const id = el.getAttribute("data-word-id");
        if (id) return id;
      }
    }
    return null;
  }, []);

  const selectionHasExcluded = useMemo(
    () => [...multiSelectIds].some((id) => excluded.has(id)),
    [multiSelectIds, excluded]
  );

  const durationMs = useMemo(() => {
    const d = project?.transcript_normalized?.duration_ms;
    if (typeof d === "number" && d > 0) return d;
    if (!words.length) return null;
    return Math.max(...words.map((w) => w.e_ms), 0);
  }, [project, words]);

  const editSuggestions = useMemo(
    () => buildClipEditSuggestions(words, excluded, roughCutExemptSet),
    [words, excluded, roughCutExemptSet]
  );
  const displaySuggestions = useMemo(
    () => [...editSuggestions, ...llmSugs],
    [editSuggestions, llmSugs]
  );

  const roughPanelSuggestions = useMemo(() => {
    const filtered = displaySuggestions.filter(
      (s) => !dismissedRoughKeys.has(s.id) && s.id !== "export-preview" && !s.id.startsWith("silence-")
    );
    return dedupeRoughCutEditSuggestions(filtered, words);
  }, [displaySuggestions, dismissedRoughKeys, words]);

  useEffect(() => {
    setLlmSugs([]);
    setWordMarkers({});
    setSilenceSegments(null);
    setLlmPhase("idle");
  }, [projectId]);

  useEffect(() => {
    setDismissedRoughKeys(readRoughDismissedSet(projectId));
  }, [projectId]);

  const postSuggestionFeedback = useCallback(
    async (event: Record<string, unknown>) => {
      try {
        await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/suggestion-feedback`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ event })
        });
      } catch {
        /* 非阻塞：反馈失败不影响剪辑 */
      }
    },
    [getAuthHeaders, projectId]
  );

  /** 与词边界/跳过逻辑的毫秒差在此阈值内视为同一位置，避免浮点噪声反复 seek 导致无法播放 */
  const handlePlaybackTimeMs = useCallback(
    (ms: number) => {
      if (!Number.isFinite(ms)) return;
      const raw = Math.round(Math.max(0, ms));
      const cap = sentenceAutopauseEndMsRef.current;
      if (cap != null && raw >= cap - 28) {
        waveformRef.current?.pause();
        sentenceAutopauseEndMsRef.current = null;
      }
      if (words.length === 0 || excludedRef.current.size === 0) {
        setPlaybackMs(raw);
        return;
      }
      const adj = adjustPlaybackMsForExcluded(words, excludedRef.current, raw, durationMs);
      const out = applyPlaybackPreRollBeforeNextKept(words, excludedRef.current, adj);
      const eps = 12;
      const needSeek = Math.abs(adj - raw) > eps || Math.abs(out - adj) > eps;
      if (needSeek) {
        waveformRef.current?.seekToMs(Math.round(out));
      }
      setPlaybackMs(out);
    },
    [words, durationMs]
  );

  const handleWaveformLoadError = useCallback((msg: string) => {
    setErr((p) => (p ? `${p}\n${msg}` : msg));
  }, []);

  const snapSeekMs = useCallback((seekMs: number) => snapMsNearWordEdges(words, seekMs, 140), [words]);

  /** 有主音频文件即可走同源 /audio/file；避免仅 has_audio 未回写时无法试听 */
  const hasServerAudio =
    Boolean(project?.has_audio) ||
    Boolean(project?.audio_download_url) ||
    Boolean(project?.audio_filename);
  const masterAudioUrl = hasServerAudio
    ? `/api/clip/projects/${encodeURIComponent(projectId)}/audio/file`
    : undefined;
  const waveformAudioUrl =
    wordchainPreviewOn && hasServerAudio
      ? `/api/clip/projects/${encodeURIComponent(projectId)}/audio/wordchain-preview?cb=${wordchainPreviewNonce}`
      : masterAudioUrl;

  const dualChannelMirror =
    Boolean(waveformAudioUrl) &&
    !wordchainPreviewOn &&
    Array.isArray(project?.channel_ids) &&
    (project?.channel_ids?.length ?? 0) >= 2;

  const audioStagingEntries = useMemo(() => {
    const st = project?.audio_staging_keys;
    return Array.isArray(st) ? st : [];
  }, [project?.audio_staging_keys]);

  const generateWordchainPreview = useCallback(async () => {
    if (!hasServerAudio || project?.transcription_status !== "succeeded") return;
    setWordchainPreviewBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/wordchain-preview`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `试听生成失败 ${res.status}`);
      }
      setWordchainPreviewNonce((n) => n + 1);
      setWordchainPreviewOn(true);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setWordchainPreviewBusy(false);
    }
  }, [getAuthHeaders, hasServerAudio, project?.transcription_status, projectId]);

  /** 主音频 object_key 就绪即可拉静音分析，不依赖转写完成 */
  const loadSilenceSegments = useCallback(async () => {
    if (!hasServerAudio) {
      setSilenceSegments(null);
      return;
    }
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/silences`, {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        segments?: ClipSilenceSegment[];
      };
      if (!res.ok || data.success === false || !Array.isArray(data.segments)) {
        setSilenceSegments([]);
        return;
      }
      setSilenceSegments(data.segments);
    } catch {
      setSilenceSegments([]);
    }
  }, [getAuthHeaders, projectId, hasServerAudio]);

  useEffect(() => {
    void loadSilenceSegments();
  }, [loadSilenceSegments]);

  const jumpToWordInTranscript = useCallback(
    (wid: string, opts?: { lineEndAutopause?: boolean }) => {
      if (scriptSearch.trim()) {
        const ids = collectSubstringMatchWordIds(words, scriptSearch, excluded);
        if (ids.includes(wid)) setSearchHlWordIds(new Set([wid]));
      }
      setFocusedWordId(wid);
      transcriptRef.current?.scrollToWordId(wid);
      const w = words.find((x) => x.id === wid);
      if (w) {
        waveformRef.current?.seekToMs(w.s_ms);
        void waveformRef.current?.play();
      }
      if (opts?.lineEndAutopause && w && lines.length) {
        const end = maxEndMsForLineContainingWordId(lines, wid, words);
        sentenceAutopauseEndMsRef.current =
          end != null && end > w.s_ms + 40 ? end : null;
      } else {
        sentenceAutopauseEndMsRef.current = null;
      }
    },
    [words, scriptSearch, excluded, lines]
  );

  const navigateScriptSearchHit = useCallback(
    (wid: string) => {
      sentenceAutopauseEndMsRef.current = null;
      setSearchHlWordIds(new Set([wid]));
      setFocusedWordId(wid);
      transcriptRef.current?.scrollToWordId(wid);
      const w = words.find((x) => x.id === wid);
      if (w) {
        waveformRef.current?.seekToMs(w.s_ms);
        void waveformRef.current?.play();
      }
    },
    [words]
  );

  const selectAllScriptSearchHits = useCallback(() => {
    if (!scriptSearchHitIdsOrdered.length) return;
    setSearchHlWordIds(new Set(scriptSearchHitIdsOrdered));
    setMultiSelectIds(new Set(scriptSearchHitIdsOrdered));
    const last = scriptSearchHitIdsOrdered[scriptSearchHitIdsOrdered.length - 1]!;
    setFocusedWordId(last);
  }, [scriptSearchHitIdsOrdered]);

  const seekPreviewMs = useCallback((ms: number) => {
    sentenceAutopauseEndMsRef.current = null;
    if (!Number.isFinite(ms)) return;
    waveformRef.current?.seekToMs(Math.round(ms));
    void waveformRef.current?.play();
  }, []);

  const transcriptionActive =
    project?.transcription_status === "running" || project?.transcription_status === "queued";
  const exportActive = project?.export_status === "running" || project?.export_status === "queued";
  const dualInterview = isDualChannels(project?.channel_ids);

  const activeWordIndex = useMemo(
    () => findPlaybackHighlightWordIndex(words, playbackMs, excluded),
    [words, playbackMs, excluded]
  );
  const playbackWordId = activeWordIndex >= 0 && words[activeWordIndex] ? words[activeWordIndex]!.id : null;

  const playbackLineIndex = useMemo(() => {
    if (!playbackWordId) return null;
    const ix = lines.findIndex((line) =>
      line.units.some((u) =>
        u.kind === "single" ? u.word.id === playbackWordId : u.words.some((w) => w.id === playbackWordId)
      )
    );
    return ix >= 0 ? ix : null;
  }, [lines, playbackWordId]);

  useEffect(() => {
    if (!playbackWordId) {
      lastScrollWordId.current = "";
      return;
    }
    if (playbackWordId === lastScrollWordId.current) return;
    lastScrollWordId.current = playbackWordId;
    transcriptRef.current?.scrollToWordId(playbackWordId);
  }, [playbackWordId]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        project?: ClipProjectRow;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `加载失败 ${res.status}`);
      }
      const p = data.project || null;
      setProject(p);
      const ex = Array.isArray(p?.excluded_word_ids) ? p!.excluded_word_ids! : [];
      setExcluded(new Set(ex.map(String)));
      excludedUndoStack.current = [];
      excludedRedoStack.current = [];
      setSaveExcludedHint("idle");
      bumpExcludedHistory();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const st = project?.transcription_status;
    const ex = project?.export_status;
    if (st === "running" || st === "queued" || ex === "running" || ex === "queued") {
      const busyPollMs = 5500;
      const id = window.setInterval(() => {
        if (projectBusyPollVisibleRef.current) void load();
      }, busyPollMs);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [load, project?.transcription_status, project?.export_status]);

  const persistExcludedNow = useCallback(
    async (next: Set<string>) => {
      setSaveExcludedHint("saving");
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ excluded_word_ids: [...next] })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存失败 ${res.status}`);
        }
        setSaveExcludedHint("saved");
        window.setTimeout(() => {
          setSaveExcludedHint((h) => (h === "saved" ? "idle" : h));
        }, 2200);
      } catch (e) {
        setSaveExcludedHint("error");
        setErr(String(e instanceof Error ? e.message : e));
      }
    },
    [getAuthHeaders, projectId]
  );

  const scheduleSaveExcluded = useCallback(
    (next: Set<string>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persistExcludedNow(next), 500);
    },
    [persistExcludedNow]
  );

  /** Word 式 Ctrl+S：立即落盘当前删词状态（跳过防抖） */
  const flushExcludedSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persistExcludedNow(new Set(excludedRef.current));
  }, [persistExcludedNow]);

  const undoExcluded = useCallback(() => {
    const prev = excludedUndoStack.current.pop();
    if (!prev) return;
    excludedRedoStack.current.push([...excludedRef.current].sort());
    const next = new Set(prev);
    setExcluded(next);
    scheduleSaveExcluded(next);
    bumpExcludedHistory();
  }, [scheduleSaveExcluded]);

  const redoExcluded = useCallback(() => {
    const nxt = excludedRedoStack.current.pop();
    if (!nxt) return;
    excludedUndoStack.current.push([...excludedRef.current].sort());
    const next = new Set(nxt);
    setExcluded(next);
    scheduleSaveExcluded(next);
    bumpExcludedHistory();
  }, [scheduleSaveExcluded]);

  const markManyExcluded = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return;
      setExcluded((prev) => {
        excludedUndoStack.current.push([...prev].sort());
        excludedRedoStack.current = [];
        const n = new Set(prev);
        for (const id of ids) n.add(id);
        scheduleSaveExcluded(n);
        return n;
      });
      bumpExcludedHistory();
    },
    [scheduleSaveExcluded]
  );

  const deleteAllScriptSearchHits = useCallback(() => {
    if (!searchAllHitsSelected || !scriptSearchHitIdsOrdered.length) return;
    markManyExcluded(scriptSearchHitIdsOrdered);
  }, [searchAllHitsSelected, scriptSearchHitIdsOrdered, markManyExcluded]);

  const markManyRestored = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return;
      setExcluded((prev) => {
        excludedUndoStack.current.push([...prev].sort());
        excludedRedoStack.current = [];
        const n = new Set(prev);
        for (const id of ids) n.delete(id);
        scheduleSaveExcluded(n);
        return n;
      });
      bumpExcludedHistory();
    },
    [scheduleSaveExcluded]
  );

  /** 将当前多选（或仅焦点词）从「已删」恢复为保留（显式按钮；与 Word 键盘 Backspace 删除选区不同） */
  const restoreSelectionFromExcluded = useCallback(() => {
    const ids = multiSelectIds.size > 0 ? [...multiSelectIds] : focusedWordId ? [focusedWordId] : [];
    const targets = ids.filter((id) => excludedRef.current.has(id));
    if (!targets.length) return;
    setExcluded((prev) => {
      excludedUndoStack.current.push([...prev].sort());
      excludedRedoStack.current = [];
      const n = new Set(prev);
      for (const id of targets) n.delete(id);
      scheduleSaveExcluded(n);
      return n;
    });
    bumpExcludedHistory();
  }, [multiSelectIds, focusedWordId, scheduleSaveExcluded]);

  useEffect(() => {
    const isTypingTarget = (ae: HTMLElement | null) => {
      if (!ae) return false;
      if (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)
        return true;
      const role = ae.getAttribute("role");
      if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
      return Boolean(ae.closest("input,textarea,select,[contenteditable='true']"));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        const ae = document.activeElement as HTMLElement | null;
        if (isTypingTarget(ae)) return;
        e.preventDefault();
        e.stopPropagation();
        if (hasServerAudio) void waveformRef.current?.playPause();
        return;
      }
      if (e.key === "Escape" && multiSelectIds.size > 0) {
        e.preventDefault();
        setMultiSelectIds(new Set());
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const el = document.activeElement as HTMLElement | null;
        if (isTypingTarget(el)) return;

        const bulk = [...multiSelectIds];
        if (bulk.length > 0) {
          e.preventDefault();
          const ex = excludedRef.current;
          const anyKeep = bulk.some((id) => !ex.has(id));
          if (!anyKeep) {
            setMultiSelectIds(new Set());
            return;
          }
          setExcluded((prev) => {
            excludedUndoStack.current.push([...prev].sort());
            excludedRedoStack.current = [];
            const n = new Set(prev);
            for (const id of bulk) n.add(id);
            scheduleSaveExcluded(n);
            return n;
          });
          bumpExcludedHistory();
          setMultiSelectIds(new Set());
          return;
        }

        const widFromDom = el?.getAttribute("data-word-id") || el?.dataset?.wordId;
        const wid = widFromDom || focusedWordId;
        if (wid) {
          e.preventDefault();
          const ex = excludedRef.current;
          const ordered = words;

          if (e.key === "Delete") {
            const w = ordered.find((x) => x.id === wid) ?? words.find((x) => x.id === wid);
            if (!w || ex.has(w.id)) return;
            setExcluded((prev) => {
              excludedUndoStack.current.push([...prev].sort());
              excludedRedoStack.current = [];
              const n = new Set(prev);
              n.add(w.id);
              scheduleSaveExcluded(n);
              return n;
            });
            bumpExcludedHistory();
            return;
          }

          const anchorList = ordered.some((x) => x.id === wid) ? ordered : words;
          const prey = findPrevUnexcludedWordId(anchorList, wid, ex);
          if (!prey) return;
          setExcluded((prev) => {
            excludedUndoStack.current.push([...prev].sort());
            excludedRedoStack.current = [];
            const n = new Set(prev);
            n.add(prey);
            scheduleSaveExcluded(n);
            return n;
          });
          bumpExcludedHistory();
          setFocusedWordId(prey);
          transcriptRef.current?.scrollToWordId(prey);
          return;
        }
      }

      if (e.key === "Home" || e.code === "Home") {
        const el = document.activeElement as HTMLElement | null;
        if (isTypingTarget(el)) return;
        const ordered = words;
        if (!ordered.length) return;
        e.preventDefault();
        const w0 = ordered[0]!;
        setFocusedWordId(w0.id);
        setMultiSelectIds(new Set());
        transcriptRef.current?.scrollToWordId(w0.id);
        return;
      }
      if (e.key === "End" || e.code === "End") {
        const el = document.activeElement as HTMLElement | null;
        if (isTypingTarget(el)) return;
        const ordered = words;
        if (!ordered.length) return;
        e.preventDefault();
        const w1 = ordered[ordered.length - 1]!;
        setFocusedWordId(w1.id);
        setMultiSelectIds(new Set());
        transcriptRef.current?.scrollToWordId(w1.id);
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const elAct = document.activeElement as HTMLElement | null;
      if (isTypingTarget(elAct)) return;

      if ((e.key === "a" || e.key === "A") && !e.shiftKey) {
        e.preventDefault();
        const ordered = words;
        if (!ordered.length) return;
        const ids = ordered.map((w) => w.id);
        setMultiSelectIds(new Set(ids));
        setFocusedWordId(ids[ids.length - 1] ?? null);
        return;
      }

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setRightDrawerOpen(true);
        setWorkbenchTab("search");
        queueMicrotask(() => {
          scriptSearchInputRef.current?.focus();
          scriptSearchInputRef.current?.select();
        });
        return;
      }

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        flushExcludedSave();
        return;
      }

      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const ordered = words;
        if (!ordered.length) return;
        const dir = e.code === "ArrowLeft" ? -1 : 1;
        let anchor = focusedWordId;
        if (multiSelectIds.size > 0) {
          const ixs = [...multiSelectIds]
            .map((id) => ordered.findIndex((w) => w.id === id))
            .filter((i) => i >= 0);
          if (ixs.length) {
            const minI = Math.min(...ixs);
            const maxI = Math.max(...ixs);
            const edgeIx = dir < 0 ? minI : maxI;
            anchor = ordered[edgeIx]!.id;
          }
        }
        if (!anchor) {
          const w = ordered[dir === 1 ? 0 : ordered.length - 1];
          if (!w) return;
          setFocusedWordId(w.id);
          setMultiSelectIds(new Set([w.id]));
          transcriptRef.current?.scrollToWordId(w.id);
          return;
        }
        const ix = ordered.findIndex((w) => w.id === anchor);
        if (ix < 0) return;
        const j = ix + dir;
        if (j < 0 || j >= ordered.length) return;
        const nw = ordered[j]!;
        setFocusedWordId(nw.id);
        setMultiSelectIds(new Set([nw.id]));
        transcriptRef.current?.scrollToWordId(nw.id);
        return;
      }

      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redoExcluded();
        else undoExcluded();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redoExcluded();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    multiSelectIds,
    focusedWordId,
    redoExcluded,
    undoExcluded,
    words,
    scheduleSaveExcluded,
    hasServerAudio,
    flushExcludedSave
  ]);

  const onRangeDragPointerDown = useCallback((w: ClipWord, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if ((e.detail ?? 0) >= 2) return;
    rangeDragAnchorRef.current = w.id;
    rangeDragMovedRef.current = false;
    const sx = e.clientX;
    const sy = e.clientY;
    setMultiSelectIds(new Set([w.id]));
    setFocusedWordId(w.id);
    rangeAnchorWordIdRef.current = w.id;

    const move = (ev: globalThis.PointerEvent) => {
      if ((ev.buttons & 1) !== 1) return;
      if ((ev.clientX - sx) ** 2 + (ev.clientY - sy) ** 2 > 36) rangeDragMovedRef.current = true;
      const anchor = rangeDragAnchorRef.current;
      if (!anchor) return;
      const curId = findWordIdUnderPoint(ev.clientX, ev.clientY);
      if (!curId) return;
      const ids = wordIdsBetweenInclusive(words, anchor, curId);
      setMultiSelectIds(new Set(ids.length ? ids : [curId]));
      setFocusedWordId(curId);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (rangeDragMovedRef.current) skipNextWordActivateRef.current = true;
      rangeDragAnchorRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [words, findWordIdUnderPoint]);

  const onRangeDragPointerEnter = useCallback((w: ClipWord, e: ReactPointerEvent<HTMLButtonElement>) => {
    const anchor = rangeDragAnchorRef.current;
    if (!anchor || (e.buttons & 1) !== 1) return;
    rangeDragMovedRef.current = true;
    const ids = wordIdsBetweenInclusive(words, anchor, w.id);
    setMultiSelectIds(new Set(ids.length ? ids : [w.id]));
    setFocusedWordId(w.id);
  }, [words]);

  const toggleWord = useCallback(
    (w: ClipWord) => {
      setExcluded((prev) => {
        excludedUndoStack.current.push([...prev].sort());
        excludedRedoStack.current = [];
        const n = new Set(prev);
        if (n.has(w.id)) n.delete(w.id);
        else n.add(w.id);
        scheduleSaveExcluded(n);
        return n;
      });
      bumpExcludedHistory();
      waveformRef.current?.seekToMs(w.s_ms);
    },
    [scheduleSaveExcluded]
  );

  const handleWordActivate = useCallback(
    (w: ClipWord, e: MouseEvent<HTMLButtonElement>) => {
      if (skipNextWordActivateRef.current && !e.shiftKey && !e.metaKey && !e.ctrlKey && e.detail < 2) {
        skipNextWordActivateRef.current = false;
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        let anchor = rangeAnchorWordIdRef.current || focusedWordId || w.id;
        if (words.findIndex((x) => x.id === anchor) < 0) anchor = w.id;
        const ids = wordIdsBetweenInclusive(words, anchor, w.id);
        setMultiSelectIds(new Set(ids.length ? ids : [w.id]));
        setFocusedWordId(w.id);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        setMultiSelectIds((prev) => {
          const n = new Set(prev);
          if (n.has(w.id)) n.delete(w.id);
          else n.add(w.id);
          return n;
        });
        rangeAnchorWordIdRef.current = w.id;
        setFocusedWordId(w.id);
        return;
      }
      rangeAnchorWordIdRef.current = w.id;
      setMultiSelectIds(new Set());
      toggleWord(w);
    },
    [focusedWordId, toggleWord, words]
  );

  const onKeepStutterFirst = useCallback(
    (ws: ClipWord[]) => {
      if (ws.length < 2) return;
      const [, ...rest] = ws;
      setExcluded((prev) => {
        excludedUndoStack.current.push([...prev].sort());
        excludedRedoStack.current = [];
        const n = new Set(prev);
        for (const x of rest) n.add(x.id);
        scheduleSaveExcluded(n);
        return n;
      });
      bumpExcludedHistory();
    },
    [scheduleSaveExcluded]
  );

  async function startTranscribe() {
    setActionBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/transcribe`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `提交转写失败 ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setActionBusy(false);
    }
  }

  const performExport = useCallback(async () => {
    setActionBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/export`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `提交导出失败 ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setActionBusy(false);
    }
  }, [getAuthHeaders, projectId, load]);

  const openExportGate = useCallback(() => {
    setExportGateErr(null);
    setExportGatePhase("idle");
    setExportGateOpen(true);
  }, []);

  const runAnalyzeFromExportGate = useCallback(async () => {
    setExportGateErr(null);
    setExportGatePhase("analyze");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/qc/analyze`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `质检失败 ${res.status}`);
      }
      await load();
    } catch (e) {
      setExportGateErr(String(e instanceof Error ? e.message : e));
    } finally {
      setExportGatePhase("idle");
    }
  }, [getAuthHeaders, projectId, load]);

  const clearMarkersForSuggestion = useCallback((s: ClipEditSuggestion) => {
    const ex = s.execute;
    if (!ex || (ex.kind !== "excludeWords" && ex.kind !== "keepStutterFirst")) return;
    setWordMarkers((prev) => {
      const next = { ...prev };
      for (const id of ex.wordIds) delete next[id];
      return next;
    });
  }, []);

  /** 侧栏行「隐藏」：再次点击恢复；隐藏规则/模型建议时清除稿面标记 */
  const toggleDismissRoughKey = useCallback(
    (id: string) => {
      setDismissedRoughKeys((prev) => {
        const next = new Set(prev);
        const wasDismissed = next.has(id);
        if (wasDismissed) next.delete(id);
        else {
          next.add(id);
          const s = displaySuggestions.find((x) => x.id === id);
          if (s) queueMicrotask(() => clearMarkersForSuggestion(s));
        }
        try {
          localStorage.setItem(`presto-rough-dismiss:${projectId}`, JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [projectId, displaySuggestions, clearMarkersForSuggestion]
  );

  const undoSuggestionFromMarker = useCallback(
    (s: ClipEditSuggestion) => {
      const ex = s.execute;
      if (ex?.kind === "excludeWords" || ex?.kind === "keepStutterFirst") {
        setExcluded((prev) => {
          excludedUndoStack.current.push([...prev].sort());
          excludedRedoStack.current = [];
          const n = new Set(prev);
          for (const id of ex.wordIds) n.delete(id);
          scheduleSaveExcluded(n);
          return n;
        });
        bumpExcludedHistory();
      }
      void postSuggestionFeedback(suggestionFeedbackPayload(s, "suggestion_undo"));
      clearMarkersForSuggestion(s);
    },
    [clearMarkersForSuggestion, postSuggestionFeedback, scheduleSaveExcluded]
  );

  const onExecuteSuggestion = useCallback(
    (s: ClipEditSuggestion) => {
      const ex = s.execute;
      if (!ex) return;
      if (ex.kind === "keepStutterFirst") {
        const ws = ex.wordIds.map((id) => words.find((x) => x.id === id)).filter(Boolean) as ClipWord[];
        if (ws.length >= 2) onKeepStutterFirst(ws);
        void postSuggestionFeedback(suggestionFeedbackPayload(s, "suggestion_apply"));
        setWordMarkers((prev) => {
          const next = { ...prev };
          for (const id of ex.wordIds) next[id] = { suggestionKey: s.id, status: "applied" };
          return next;
        });
        return;
      }
      if (ex.kind === "excludeWords") {
        if (ex.wordIds.length === 0) return;
        setExcluded((prev) => {
          excludedUndoStack.current.push([...prev].sort());
          excludedRedoStack.current = [];
          const n = new Set(prev);
          for (const id of ex.wordIds) n.add(id);
          scheduleSaveExcluded(n);
          return n;
        });
        bumpExcludedHistory();
        void postSuggestionFeedback(suggestionFeedbackPayload(s, "suggestion_apply"));
        setWordMarkers((prev) => {
          const next = { ...prev };
          for (const id of ex.wordIds) next[id] = { suggestionKey: s.id, status: "applied" };
          return next;
        });
        return;
      }
      if (ex.kind === "startExport") {
        void postSuggestionFeedback({
          kind: "suggestion_apply",
          suggestion_id: s.id,
          source: s.source,
          execute_kind: "startExport",
          title: s.title.slice(0, 120)
        });
        openExportGate();
      }
    },
    [words, onKeepStutterFirst, scheduleSaveExcluded, postSuggestionFeedback, openExportGate]
  );

  const loadDeepseekOutline = useCallback(async () => {
    if (project?.transcription_status !== "succeeded") return;
    setLlmPhase("outline");
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/edit-suggestions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ llm: true, mode: "outline", max_words: 1000 })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        items?: LlmSuggestionApiItem[];
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `意向建议失败 ${res.status}`);
      }
      const mapped = mapLlmApiItemsToSuggestions(Array.isArray(data.items) ? data.items : []);
      setLlmSugs(mapped);
      setWordMarkers({});
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLlmPhase("idle");
    }
  }, [getAuthHeaders, projectId, project?.transcription_status]);

  const loadDeepseekStructured = useCallback(async () => {
    if (project?.transcription_status !== "succeeded") return;
    setLlmPhase("structured");
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/edit-suggestions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ llm: true, mode: "structured", max_words: 1000 })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        items?: LlmSuggestionApiItem[];
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `词级建议失败 ${res.status}`);
      }
      const mapped = mapLlmApiItemsToSuggestions(Array.isArray(data.items) ? data.items : []);
      setLlmSugs(mapped);
      setWordMarkers(initialWordMarkersFromSuggestions(mapped));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLlmPhase("idle");
    }
  }, [getAuthHeaders, projectId, project?.transcription_status]);

  const loadDeepseekExpandOutline = useCallback(
    async (src: ClipOutlineSource) => {
      if (project?.transcription_status !== "succeeded") return;
      setLlmPhase("expand");
      setErr("");
      void postSuggestionFeedback({
        kind: "outline_expand",
        suggestion_id: src.suggestionId,
        title: src.title.slice(0, 80)
      });
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/edit-suggestions`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            llm: true,
            mode: "expand",
            title: src.title,
            body: src.body,
            suggestion_id: src.suggestionId,
            max_words: 1000
          })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          items?: LlmSuggestionApiItem[];
          detail?: string;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `展开失败 ${res.status}`);
        }
        const mapped = mapLlmApiItemsToSuggestions(Array.isArray(data.items) ? data.items : []);
        setLlmSugs((prev) => {
          const rest = prev.filter((p) => p.outlineSource?.suggestionId !== src.suggestionId);
          return [...rest, ...mapped];
        });
        setWordMarkers((prev) => ({ ...prev, ...initialWordMarkersFromSuggestions(mapped) }));
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      } finally {
        setLlmPhase("idle");
      }
    },
    [getAuthHeaders, projectId, project?.transcription_status, postSuggestionFeedback]
  );

  const transcriptMarkers = useMemo((): Record<string, TranscriptWordSuggestionMarker> => {
    const out: Record<string, TranscriptWordSuggestionMarker> = {};
    const sugById = new Map(displaySuggestions.map((x) => [x.id, x] as const));
    for (const [wid, meta] of Object.entries(wordMarkers)) {
      const s = sugById.get(meta.suggestionKey);
      const ex = s?.execute;
      if (!s || !ex || (ex.kind !== "excludeWords" && ex.kind !== "keepStutterFirst")) continue;
      const snap = s;
      const st = meta.status;
      out[wid] = {
        status: st,
        applyLabel: t("presto.flow.markApply"),
        undoLabel: t("presto.flow.markUndo"),
        onApply: () => onExecuteSuggestion(snap),
        onUndo: () => undoSuggestionFromMarker(snap),
        suggestionTitle: snap.title,
        suggestionBody: snap.body,
        actionsHeading: t("presto.flow.suggestionHoverActions")
      };
    }
    return out;
  }, [displaySuggestions, wordMarkers, t, onExecuteSuggestion, undoSuggestionFromMarker]);

  const engineState = mapTranscriptionToEngine(project?.transcription_status);
  const ts = project?.transcription_status;
  const engineLabel = (() => {
    if (!ts || ts === "idle") return "";
    if (ts === "succeeded") return "";
    if (ts === "failed") return t("presto.flow.engineFailedShort");
    if (ts === "queued" || ts === "running") return t("presto.flow.engineTranscribingShort");
    return "";
  })();

  if (loading && !project) {
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] items-center justify-center bg-canvas text-sm text-muted">
        {t("clip.loading")}
      </div>
    );
  }

  if (!project && !loading) {
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-4">
        <p className="text-sm text-danger-ink">{err || t("clip.editor.notFound")}</p>
        <Link href="/clip" className="text-sm text-brand hover:underline">
          {t("clip.backToList")}
        </Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] items-center justify-center bg-canvas text-sm text-muted">
        {t("clip.loading")}
      </div>
    );
  }

  const workbenchPanelTitle =
    workbenchTab === "suggestions"
      ? t("presto.flow.drawer.tabSuggestions")
      : workbenchTab === "engine"
        ? t("presto.flow.drawer.tabEngine")
        : t("presto.flow.drawer.tabSearch");

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <ClipExportQcGateModal
        open={exportGateOpen}
        title={t("presto.flow.exportGate.title")}
        bodyIntro={t("presto.flow.exportGate.body")}
        hasReport={Boolean(project?.qc_report && Object.keys(project.qc_report as object).length > 0)}
        reportSummary={
          project?.qc_report ? JSON.stringify(project.qc_report, null, 2).slice(0, 2000) : ""
        }
        cancelLabel={t("presto.flow.exportGate.cancel")}
        analyzeLabel={t("presto.flow.exportGate.analyze")}
        skipExportLabel={t("presto.flow.exportGate.skip")}
        busyAnalyze={exportGatePhase === "analyze"}
        busyExport={exportGatePhase === "export"}
        error={exportGateErr}
        onCancel={() => {
          setExportGateOpen(false);
          setExportGateErr(null);
        }}
        onAnalyze={() => void runAnalyzeFromExportGate()}
        onSkipExport={() => {
          void (async () => {
            setExportGateErr(null);
            setExportGatePhase("export");
            try {
              await performExport();
              setExportGateOpen(false);
            } catch {
              /* performExport 已 setErr */
            } finally {
              setExportGatePhase("idle");
            }
          })();
        }}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PrestoFlowHeader
              backHref="/clip"
              backLabel={t("clip.backToList")}
              title={project.title || projectId}
              engineLabel={engineLabel}
              engineState={engineState}
              beforeTranscribe={
                <div className="min-w-0 flex-1">
                  <PrestoFlowImportBar
                    variant="inline"
                    projectId={projectId}
                    getAuthHeaders={getAuthHeaders}
                    hasMainAudio={hasServerAudio}
                    disabled={
                      actionBusy ||
                      transcriptionActive ||
                      exportActive ||
                      project.transcription_status === "succeeded"
                    }
                    disabledReason={
                      project.transcription_status === "succeeded"
                        ? t("presto.flow.importDisabledTranscribed")
                        : undefined
                    }
                    label={t("presto.flow.importAudio")}
                    busyLabel={t("presto.flow.importBusy")}
                    hint={t("presto.flow.importHint")}
                    replaceWarn={t("presto.flow.importReplaceWarn")}
                    onDone={() => void load()}
                    onError={(msg) => setErr(msg)}
                    allowMultiSegment={
                      project.transcription_status !== "succeeded" &&
                      project.transcription_status !== "running" &&
                      project.transcription_status !== "queued"
                    }
                  />
                </div>
              }
              transcribeLabel={t("clip.editor.transcribeShort")}
              exportLabel={t("clip.editor.export")}
              transcribeDisabled={
                actionBusy ||
                !hasServerAudio ||
                project.transcription_status === "running" ||
                project.transcription_status === "queued" ||
                project.transcription_status === "succeeded"
              }
              exportDisabled={
                actionBusy ||
                project.transcription_status !== "succeeded" ||
                project.export_status === "running" ||
                project.export_status === "queued"
              }
              onTranscribe={() => void startTranscribe()}
              onExport={() => openExportGate()}
            />
            {dualInterview ? (
              <p className="border-b border-line bg-fill/30 px-4 py-1.5 text-[11px] text-muted">{t("presto.flow.interviewDual")}</p>
            ) : null}
            {err ? (
              <p className="px-4 py-2 text-sm text-danger-ink" role="alert">
                {err}
              </p>
            ) : null}
            {project.transcription_error ? (
              <p className="px-4 text-sm text-danger-ink">{project.transcription_error}</p>
            ) : null}
            {project.export_error ? <p className="px-4 text-sm text-danger-ink">{project.export_error}</p> : null}

            {transcriptFullscreen ? (
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <section
                  aria-label={t("presto.flow.region.script")}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface/20"
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-2 pt-2">
                    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                      <div className="flex-1">
                        {multiSelectIds.size > 0 ? (
                          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] leading-relaxed text-muted">
                            <p className="min-w-0 flex-1">
                              {t("presto.flow.multiSelectBanner").replace("{count}", String(multiSelectIds.size))}
                            </p>
                            {selectionHasExcluded ? (
                              <button
                                type="button"
                                className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-brand shadow-soft hover:bg-fill"
                                onClick={() => restoreSelectionFromExcluded()}
                              >
                                {t("presto.flow.restoreSelection")}
                              </button>
                            ) : null}
                          </div>
                        ) : words.length > 0 ? (
                          <p className="line-clamp-2 shrink-0 text-[10px] leading-relaxed text-muted">{t("presto.flow.multiSelectHint")}</p>
                        ) : null}
                        {saveExcludedHint !== "idle" ? (
                          <p className="shrink-0 text-[10px] text-muted">
                            {saveExcludedHint === "saving"
                              ? t("clip.editor.saveExcludedSaving")
                              : saveExcludedHint === "saved"
                                ? t("clip.editor.saveExcludedSaved")
                                : t("clip.editor.saveExcludedFailed")}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-fill hover:text-ink"
                        aria-label={transcriptFullscreen ? t("presto.flow.exitFullscreen") : t("presto.flow.enterFullscreen")}
                        title={transcriptFullscreen ? t("presto.flow.exitFullscreen") : t("presto.flow.enterFullscreen")}
                        onClick={() => setTranscriptFullscreen(!transcriptFullscreen)}
                      >
                        {transcriptFullscreen ? (
                          <Minimize2 className="h-4 w-4" aria-hidden />
                        ) : (
                          <Maximize2 className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    </div>
                    {transcriptionActive && words.length === 0 ? (
                      <div className="mb-2 shrink-0 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                        {t("clip.editor.transcribingBody")}
                      </div>
                    ) : null}
                    {exportActive && project.transcription_status === "succeeded" ? (
                      <div
                        className="mb-2 shrink-0 rounded-lg border border-line bg-fill px-3 py-2 text-xs text-muted"
                        role="status"
                      >
                        {t("clip.editor.exportingBody")}
                      </div>
                    ) : null}
                    <VirtualizedTranscript
                      ref={transcriptRef}
                      lines={lines}
                      excluded={excluded}
                      playbackWordId={playbackWordId}
                      playbackLineIndex={playbackLineIndex}
                      focusedWordId={focusedWordId}
                      multiSelectIds={multiSelectIds}
                      onFocusWordId={setFocusedWordId}
                      onActivateWord={handleWordActivate}
                      onRangeDragPointerDown={onRangeDragPointerDown}
                      onRangeDragPointerEnter={onRangeDragPointerEnter}
                      transcriptScrollRef={transcriptScrollElRef}
                      onLongPressWord={() => {}}
                      ariaKeepLabel={t("clip.editor.wordAriaKeep")}
                      ariaCutLabel={t("clip.editor.wordAriaCut")}
                      hostLabel={t("presto.flow.speakerHost")}
                      guestLabel={t("presto.flow.speakerGuest")}
                      emptyLabel={
                        hasServerAudio ? t("presto.flow.transcriptEmpty") : t("presto.flow.editorNoAudioHint")
                      }
                      stutterDupHint={t("presto.flow.stutterDupHint")}
                      stutterGroupHint={t("presto.flow.stutterGroupHint")}
                      markersByWordId={transcriptMarkers}
                      roughCutHighlightIds={roughCutHighlightIds}
                      dismissedRoughKeys={dismissedRoughKeys}
                    />
                  </div>
                </section>
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-0 pb-0 pt-0 lg:flex-row lg:items-stretch">
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:min-w-0 lg:flex-[1.28]">
                  <section
                    aria-label={t("presto.flow.region.script")}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-line bg-surface/20"
                  >
                    <div className="shrink-0 border-b border-line bg-fill/15 px-2 py-2">
                      <ClipStagingTracksBar
                        projectId={projectId}
                        entries={audioStagingEntries}
                        getAuthHeaders={getAuthHeaders}
                        disabled={actionBusy || transcriptionActive || exportActive}
                        onRefresh={() => void load()}
                        onError={(msg) => setErr(msg)}
                      />
                      {wordchainPreviewOn ? (
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/25 bg-brand/10 px-2.5 py-1.5 text-[10px] text-ink">
                          <span className="min-w-0 flex-1 leading-snug">{t("presto.flow.roughCut.wordchainPreviewBanner")}</span>
                          <button
                            type="button"
                            className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-brand shadow-soft hover:bg-fill"
                            onClick={() => setWordchainPreviewOn(false)}
                          >
                            {t("presto.flow.roughCut.wordchainPreviewExit")}
                          </button>
                        </div>
                      ) : null}
                      <AudioConsole
                        dockEmbed
                        audioUrl={waveformAudioUrl}
                        onTimeMs={handlePlaybackTimeMs}
                        onLoadError={handleWaveformLoadError}
                        waveformRef={waveformRef}
                        snapSeekMs={snapSeekMs}
                        playbackRate={playbackRate}
                        onPlaybackRateChange={setPlaybackRate}
                        mirrorWaveformCount={dualChannelMirror ? 1 : 0}
                        multiTrackHint={dualChannelMirror ? t("presto.flow.audioMultiTrack.dualHint") : undefined}
                        rateOptionLabels={[
                          t("presto.flow.playbackRate1"),
                          t("presto.flow.playbackRate125"),
                          t("presto.flow.playbackRate150"),
                          t("presto.flow.playbackRate200")
                        ]}
                        rateSelectAriaLabel={t("presto.flow.playbackRateAria")}
                      />
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-2 pt-2">
                      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                        <div className="flex-1">
                          {multiSelectIds.size > 0 ? (
                            <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] leading-relaxed text-muted">
                              <p className="min-w-0 flex-1">
                                {t("presto.flow.multiSelectBanner").replace("{count}", String(multiSelectIds.size))}
                              </p>
                              {selectionHasExcluded ? (
                                <button
                                  type="button"
                                  className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-brand shadow-soft hover:bg-fill"
                                  onClick={() => restoreSelectionFromExcluded()}
                                >
                                  {t("presto.flow.restoreSelection")}
                                </button>
                              ) : null}
                            </div>
                          ) : words.length > 0 ? (
                            <p className="line-clamp-2 shrink-0 text-[10px] leading-relaxed text-muted">{t("presto.flow.multiSelectHint")}</p>
                          ) : null}
                          {saveExcludedHint !== "idle" ? (
                            <p className="shrink-0 text-[10px] text-muted">
                              {saveExcludedHint === "saving"
                                ? t("clip.editor.saveExcludedSaving")
                                : saveExcludedHint === "saved"
                                  ? t("clip.editor.saveExcludedSaved")
                                  : t("clip.editor.saveExcludedFailed")}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-fill hover:text-ink"
                          aria-label={transcriptFullscreen ? t("presto.flow.exitFullscreen") : t("presto.flow.enterFullscreen")}
                          title={transcriptFullscreen ? t("presto.flow.exitFullscreen") : t("presto.flow.enterFullscreen")}
                          onClick={() => setTranscriptFullscreen(!transcriptFullscreen)}
                        >
                          {transcriptFullscreen ? (
                            <Minimize2 className="h-4 w-4" aria-hidden />
                          ) : (
                            <Maximize2 className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </div>
                      {transcriptionActive && words.length === 0 ? (
                        <div className="mb-2 shrink-0 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                          {t("clip.editor.transcribingBody")}
                        </div>
                      ) : null}
                      {exportActive && project.transcription_status === "succeeded" ? (
                        <div
                          className="mb-2 shrink-0 rounded-lg border border-line bg-fill px-3 py-2 text-xs text-muted"
                          role="status"
                        >
                          {t("clip.editor.exportingBody")}
                        </div>
                      ) : null}
                      <VirtualizedTranscript
                        ref={transcriptRef}
                        lines={lines}
                        excluded={excluded}
                        playbackWordId={playbackWordId}
                        playbackLineIndex={playbackLineIndex}
                        focusedWordId={focusedWordId}
                        multiSelectIds={multiSelectIds}
                        onFocusWordId={setFocusedWordId}
                        onActivateWord={handleWordActivate}
                        onRangeDragPointerDown={onRangeDragPointerDown}
                        onRangeDragPointerEnter={onRangeDragPointerEnter}
                        transcriptScrollRef={transcriptScrollElRef}
                        onLongPressWord={() => {}}
                        ariaKeepLabel={t("clip.editor.wordAriaKeep")}
                        ariaCutLabel={t("clip.editor.wordAriaCut")}
                        hostLabel={t("presto.flow.speakerHost")}
                        guestLabel={t("presto.flow.speakerGuest")}
                        emptyLabel={
                          hasServerAudio ? t("presto.flow.transcriptEmpty") : t("presto.flow.editorNoAudioHint")
                        }
                        stutterDupHint={t("presto.flow.stutterDupHint")}
                        stutterGroupHint={t("presto.flow.stutterGroupHint")}
                        markersByWordId={transcriptMarkers}
                        roughCutHighlightIds={roughCutHighlightIds}
                        dismissedRoughKeys={dismissedRoughKeys}
                      />
                    </div>
                  </section>
                </div>
                <aside
                  className="flex min-h-0 w-auto shrink-0 border-l border-line bg-surface/95 text-ink lg:flex-none"
                  aria-label={t("presto.flow.sideDock")}
                >
                  <nav
                    className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line/70 py-2"
                    aria-label={t("presto.flow.sideDock.tabs")}
                  >
                    {(
                      [
                        ["suggestions", Sparkles, t("presto.flow.drawer.tabSuggestions")] as const,
                        ["engine", SlidersHorizontal, t("presto.flow.drawer.tabEngine")] as const,
                        ["search", Search, t("presto.flow.drawer.tabSearch")] as const
                      ] as const
                    ).map(([id, Icon, label]) => {
                      const active = workbenchTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          title={label}
                          aria-label={label}
                          aria-pressed={active}
                          onClick={() => {
                            setWorkbenchTab(id);
                            setRightDrawerOpen(true);
                          }}
                          className={[
                            "flex h-10 w-10 items-center justify-center rounded-lg transition",
                            active && rightDrawerOpen
                              ? "bg-brand/18 text-brand shadow-inset-brand"
                              : "text-muted hover:bg-fill hover:text-ink"
                          ].join(" ")}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        </button>
                      );
                    })}
                    <div className="min-h-3 flex-1" aria-hidden />
                    <button
                      type="button"
                      aria-label={t("clip.editor.downloadExport")}
                      title={t("clip.editor.downloadExport")}
                      disabled={!project.export_download_url}
                      onClick={() => {
                        const u = project.export_download_url;
                        if (u) window.open(u, "_blank", "noopener,noreferrer");
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-fill hover:text-ink disabled:pointer-events-none disabled:opacity-35"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </button>
                    {!rightDrawerOpen ? (
                      <button
                        type="button"
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-fill hover:text-ink"
                        aria-label={t("presto.flow.sideDock.toggleExpand")}
                        title={t("presto.flow.sideDock.toggleExpand")}
                        onClick={() => setRightDrawerOpen(true)}
                      >
                        <PanelRightOpen className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </nav>
                  {rightDrawerOpen ? (
                    <div className="flex min-h-0 w-[min(18rem,88vw)] min-w-[15rem] max-w-[min(24rem,40vw)] flex-col border-l border-line/60 bg-surface">
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
                        <span className="truncate text-xs font-semibold tracking-tight text-ink">{workbenchPanelTitle}</span>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-muted transition hover:bg-fill hover:text-ink"
                          aria-label={t("presto.flow.sideDock.toggleCollapse")}
                          title={t("presto.flow.sideDock.toggleCollapse")}
                          onClick={() => setRightDrawerOpen(false)}
                        >
                          <PanelRightClose className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto">
                        {workbenchTab === "suggestions" ? (
                          <ClipRoughCutPanel
                            projectId={projectId}
                            project={project}
                            words={words}
                            excluded={excluded}
                            onMarkExcluded={markManyExcluded}
                            onMarkRestored={markManyRestored}
                            onProjectPatch={setProject}
                            getAuthHeaders={getAuthHeaders}
                            onRefreshProject={load}
                            onError={(msg) => setErr(msg)}
                            exemptCores={roughCutExemptSet}
                            silenceSegments={silenceSegments}
                            onJumpWord={jumpToWordInTranscript}
                            onSeekPreviewMs={seekPreviewMs}
                            onRefreshSilences={loadSilenceSegments}
                            roughCutSuggestions={roughPanelSuggestions}
                            onExecuteSuggestion={onExecuteSuggestion}
                            dismissedRoughKeys={dismissedRoughKeys}
                            onToggleDismissRoughKey={toggleDismissRoughKey}
                            transcriptionSucceeded={project.transcription_status === "succeeded"}
                            deepseekOutlineBusy={llmPhase === "outline"}
                            deepseekStructuredBusy={llmPhase === "structured"}
                            outlineExpandBusy={llmPhase === "expand"}
                            onLoadDeepseekOutline={
                              project.transcription_status === "succeeded"
                                ? () => void loadDeepseekOutline()
                                : undefined
                            }
                            onLoadDeepseekStructured={
                              project.transcription_status === "succeeded"
                                ? () => void loadDeepseekStructured()
                                : undefined
                            }
                            onExpandOutline={(src) => void loadDeepseekExpandOutline(src)}
                            hasServerAudio={hasServerAudio}
                            wordchainPreviewActive={wordchainPreviewOn}
                            wordchainPreviewBusy={wordchainPreviewBusy}
                            onGenerateWordchainPreview={() => void generateWordchainPreview()}
                            onExitWordchainPreview={() => setWordchainPreviewOn(false)}
                          />
                        ) : null}
                        {workbenchTab === "engine" ? (
                          <ClipRepairPanel
                            projectId={projectId}
                            project={project}
                            getAuthHeaders={getAuthHeaders}
                            transcriptionStatus={project.transcription_status}
                            onRefreshProject={load}
                            onProjectUpdated={setProject}
                            onError={(msg) => setErr(msg)}
                          />
                        ) : null}
                        {workbenchTab === "search" ? (
                          <ClipScriptSearchPanel
                            words={words}
                            lines={lines}
                            excluded={excluded}
                            scriptSearch={scriptSearch}
                            onScriptSearch={setScriptSearch}
                            scriptSearchInputRef={scriptSearchInputRef}
                            onNavigateSearchHit={navigateScriptSearchHit}
                            activeHighlightWordId={activeSearchHighlightWordId}
                            onSelectAllSearchHits={selectAllScriptSearchHits}
                            searchAllHitsSelected={searchAllHitsSelected}
                            allSearchHitsHighlighted={allSearchHitsHighlighted}
                            onDeleteAllSearchHits={deleteAllScriptSearchHits}
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </aside>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
