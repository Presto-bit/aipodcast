"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { CircleHelp, Download, History, PanelRightClose, PanelRightOpen, Scissors, Search, SlidersHorizontal, Sparkles } from "../icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Maximize2, Minimize2 } from "../icons";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { consumePostAuthActionForCurrentPath } from "../../lib/authPostAction";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import type { ClipProjectRow, ClipSilenceSegment, ClipWord } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import { WORKBENCH_PODCAST_CLIP_PATH } from "../../lib/navPaths";
import {
  adjustPlaybackMsForExcluded,
  approximateEditedTimelineMs,
  approximateMasterTimelineMs,
  applyPlaybackPreRollBeforeNextKept,
  findPlaybackHighlightWordIndex,
  rawWithinFocusWordPlaybackHold,
  snapMsNearWordEdges
} from "../../lib/prestoFlowPlayback";
import { lameQFromExportOptions } from "../../lib/clipExportQuality";
import {
  buildClipEditSuggestions,
  buildRuleVerbalReviewRequest,
  dedupeRoughCutEditSuggestions,
  mapLlmApiItemsToSuggestions,
  mergeRuleVerbalReviewResponse,
  type ClipEditSuggestion,
  type ClipOutlineSource,
  type LlmSuggestionApiItem
} from "../../lib/prestoFlowAiSuggestions";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import { collectSubstringMatchWordIds, collectVerbalTicWordIds, verbalTicRowDismissId } from "../../lib/prestoFlowRoughCutLexicon";
import {
  buildFlowUnits,
  groupSpeakerTurnLines,
  maxEndMsForLineContainingWordId,
  wordIdsBetweenInclusive
} from "../../lib/prestoFlowTranscript";
import type { ClipAudioHandle } from "../clip/clipAudioHandle";
const ClipAudioTransport = dynamic(() => import("../clip/ClipAudioTransport"), { ssr: false });
const ClipVirtualAudioTransport = dynamic(() => import("../clip/ClipVirtualAudioTransport"), { ssr: false });
import {
  perStagingEntryDurationMs,
  sumStagingEntriesDurationMs
} from "../../lib/clipSegmentDurationEstimate";
import {
  buildMaterialTimelineSlices,
  buildVirtualAudioCues,
  clipWordGlobalPlaybackMs,
  maxSegDurationMsByKeyFromWords,
  totalVirtualDurationMs
} from "../../lib/clipVirtualTimeline";
import AudioConsole from "./AudioConsole";
import ClipStagingTracksBar from "./ClipStagingTracksBar";
import ClipRepairPanel from "./ClipRepairPanel";
import ClipRoughCutPanel from "./ClipRoughCutPanel";
import ClipScriptSearchPanel from "./ClipScriptSearchPanel";
import PrestoFlowHeader from "./PrestoFlowHeader";
import PrestoFlowImportBar from "./PrestoFlowImportBar";
import VirtualizedTranscript, { type VirtualizedTranscriptHandle } from "./VirtualizedTranscript";
import WaveformSegmentEditor from "./WaveformSegmentEditor";
import { useLoginRequiredAction } from "../../lib/useLoginRequiredAction";
import { isAbortError, usePageAbortSignal, usePageFetch } from "../../lib/usePageAbortSignal";
import { downloadClipExportMp3 } from "../../lib/clipExportDownload";
import { clipEditorUsesPrdLayout } from "../../lib/clipEditorPrdUi";
import ClipEditorPrdLeftRail from "./ClipEditorPrdLeftRail";
import ClipEditorPrdScriptToolbar from "./ClipEditorPrdScriptToolbar";
import ClipEditorPrdTopBar from "./ClipEditorPrdTopBar";
import ClipExportQualitySelect from "./ClipExportQualitySelect";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import {
  buildInitialAudioSegments,
  firstWordIdAtOrAfterMs,
  initialWordMarkersFromSuggestions,
  isDualChannels,
  mapTranscriptionToEngine,
  normalizeSegmentTimeline,
  readRoughDismissedSet,
  reorderWordsBySegments,
  suggestionFeedbackPayload,
  type EditorAudioSegment,
  type EngineHeaderState
} from "./prestoFlowEditorBootstrap";

function friendlyWaveformError(msg: string): string {
  const raw = msg.trim();
  if (!raw) return "波形加载失败";
  if (/DEMUXER_ERROR|no supported streams|FFmpegDemuxer/i.test(raw)) {
    return "音频预览加载失败，请稍后重试；若持续失败请联系支持。";
  }
  if (/MEDIA_ERR_SRC_NOT_SUPPORTED|MEDIA_ERR_DECODE/i.test(raw)) {
    return "音频预览解码失败，请刷新页面后重试。";
  }
  if (raw === "waveform_error" || /^无法(播放|加载)/.test(raw)) {
    return raw;
  }
  return raw;
}

export default function PrestoFlowEditor({ projectId }: { projectId: string }) {
  const usePrdLayout = clipEditorUsesPrdLayout();
  const { t } = useI18n();
  const { user, getAuthHeaders } = useAuth();
  const loggedIn = useMemo(() => isLoggedInAccountUser(user), [user]);
  const { ensureLoggedInForAction, loginPromptNode } = useLoginRequiredAction(loggedIn);
  const pageAbortSignal = usePageAbortSignal();
  const pageFetch = usePageFetch(pageAbortSignal);

  const [project, setProject] = useState<ClipProjectRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  /** 波形/试听解码错误，与操作类 err、服务端 transcription_error 分开展示 */
  const [waveformErr, setWaveformErr] = useState("");
  const [projectTitleEditing, setProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [projectTitleBusy, setProjectTitleBusy] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  /** PRD 稿面工具条：一键修音进行中 */
  const [prdRepairBusyKind, setPrdRepairBusyKind] = useState<"" | "ambient" | "voice_clarity" | "loudnorm">("");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [focusedWordId, setFocusedWordId] = useState<string | null>(null);
  const [llmSugs, setLlmSugs] = useState<ClipEditSuggestion[]>([]);
  /** idle | structured | expand */
  const [llmPhase, setLlmPhase] = useState<"idle" | "structured" | "expand">("idle");
  const [silenceSegments, setSilenceSegments] = useState<ClipSilenceSegment[] | null>(null);
  /** 粗剪侧栏：不再展示的建议（口癖行 / 规则&AI / 长静音），按工程存 localStorage */
  const [dismissedRoughKeys, setDismissedRoughKeys] = useState<Set<string>>(() => new Set());
  /** 稿面词级标记：suggestionKey 对应 ClipEditSuggestion.id */
  const [wordMarkers, setWordMarkers] = useState<Record<string, { suggestionKey: string; status: "pending" | "applied" }>>(
    {}
  );
  /** 右侧工作台：默认收起以加宽稿面与音频区；可随时点开 */
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<"suggestions" | "engine" | "search" | "history">("suggestions");
  /** 侧栏「搜索」：稿面子串高亮与批量删词 */
  const [scriptSearch, setScriptSearch] = useState("");
  /** 稿面仅高亮当前搜索命中子集（默认首处；下一个 / 全选 / 点句子后更新） */
  const [searchHlWordIds, setSearchHlWordIds] = useState<Set<string>>(() => new Set());
  const [playbackRate, setPlaybackRate] = useState(1);
  /** 与波形 / 虚拟多段 audio 元素同步，供 AudioConsole 播放按钮图标 */
  const [waveformPlaying, setWaveformPlaying] = useState(false);
  const [waveZoomLevel, setWaveZoomLevel] = useState(1);
  const [audioSegments, setAudioSegments] = useState<EditorAudioSegment[]>([]);
  const [clipToolsOpen, setClipToolsOpen] = useState(false);
  const [dragSegmentId, setDragSegmentId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [insertingSegmentAudio, setInsertingSegmentAudio] = useState(false);
  /** 剪辑试听：与终版导出同管线，有删改时自动后台生成并切换波形源 */
  const [wordchainPreviewOn, setWordchainPreviewOn] = useState(false);
  const [wordchainPreviewNonce, setWordchainPreviewNonce] = useState(0);
  const [wordchainPreviewBusy, setWordchainPreviewBusy] = useState(false);
  const editedPreviewInFlightRef = useRef(false);
  const pendingPlayAfterPreviewRef = useRef(false);
  const editedPreviewFingerprintRef = useRef<string | null>(null);
  const transcriptUsesEditedPreviewRef = useRef(false);
  const wordchainPreviewOnRef = useRef(false);
  const needsEditedPreviewRef = useRef(false);
  const [deleteFeedback, setDeleteFeedback] = useState<string>("");
  /** Shift+点击或「整句」选中的词 id，Delete 批量标记删除 */
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(() => new Set());
  /** 文稿区域全屏模式 */
  const [transcriptFullscreen, setTranscriptFullscreen] = useState(false);
  const [speakerNames, setSpeakerNames] = useState<Record<number, string>>({});
  const [audioEventsAnalyzeBusy, setAudioEventsAnalyzeBusy] = useState(false);
  const [audioEventsAnalyzeHint, setAudioEventsAnalyzeHint] = useState<string | null>(null);
  const [speakerFocusSet, setSpeakerFocusSet] = useState<Set<number>>(() => new Set());
  const [onlySelectedSpeakers, setOnlySelectedSpeakers] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [transcribeConfirmOpen, setTranscribeConfirmOpen] = useState(false);
  /** 多段素材时「开始转写」仅提交勾选的 object_key；顺序与列表一致 */
  const [stagingTranscribeSelectedKeys, setStagingTranscribeSelectedKeys] = useState<string[]>([]);
  const [actionHint, setActionHint] = useState<string>("");
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevExportStatusRef = useRef<string | null>(null);
  const deleteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyApplyingRef = useRef(false);
  const editUndoStackRef = useRef<Array<{ excludedIds: string[]; timeline: Record<string, unknown> | null; label: string }>>([]);
  const editRedoStackRef = useRef<Array<{ excludedIds: string[]; timeline: Record<string, unknown> | null; label: string }>>([]);
  const [historyActions, setHistoryActions] = useState<
    Array<{
      id: string;
      label: string;
      at: number;
      seekMs: number | null;
      snapshot: { excludedIds: string[]; timeline: Record<string, unknown> | null };
    }>
  >([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const waveformRef = useRef<ClipAudioHandle | null>(null);
  const waveformLoadErrDedupRef = useRef<{ msg: string; at: number }>({ msg: "", at: 0 });
  /** 与 focusedWordId 同步，供 playback 回调读取 */
  const focusedWordIdRef = useRef<string | null>(null);
  /** 稿面/侧栏程序化定位后的短时间窗内：不应用「跳过已剪掉词」seek，避免一跳即被挪到相邻保留词 */
  const playbackExcludedBypassUntilRef = useRef(0);
  const transcriptRef = useRef<VirtualizedTranscriptHandle | null>(null);
  const autoStructuredSuggestionRequestedRef = useRef(false);
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
  const insertBoundaryIndexRef = useRef<number | null>(null);
  const insertAudioInputRef = useRef<HTMLInputElement | null>(null);
  const segmentUndoStackRef = useRef<EditorAudioSegment[][]>([]);
  const segmentRedoStackRef = useRef<EditorAudioSegment[][]>([]);
  /** 记录当前多选是否来源于左键拖选，用于 Delete/Backspace 批量删除 */
  const leftDragMultiSelectRef = useRef(false);
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
    focusedWordIdRef.current = focusedWordId;
  }, [focusedWordId]);

  useEffect(() => {
    return () => {
      if (deleteFeedbackTimerRef.current) clearTimeout(deleteFeedbackTimerRef.current);
      if (actionHintTimerRef.current) clearTimeout(actionHintTimerRef.current);
    };
  }, []);

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
    leftDragMultiSelectRef.current = false;
  }, [projectId]);

  useEffect(() => {
    setScriptSearch("");
    setSearchHlWordIds(new Set());
  }, [projectId]);

  useEffect(() => {
    setWordchainPreviewOn(false);
    setWordchainPreviewNonce(0);
    setWaveZoomLevel(1);
    setAudioSegments([]);
    segmentUndoStackRef.current = [];
    segmentRedoStackRef.current = [];
  }, [projectId]);

  useEffect(() => {
    setAudioEventsAnalyzeHint(null);
    setAudioEventsAnalyzeBusy(false);
    setSpeakerFocusSet(new Set());
    setOnlySelectedSpeakers(false);
    setShortcutHelpOpen(false);
    setActionHint("");
    setSelectedHistoryId(null);
  }, [projectId]);

  useEffect(() => {
    if (speakerFocusSet.size === 0) setOnlySelectedSpeakers(false);
  }, [speakerFocusSet]);

  const pushActionHint = useCallback((msg: string) => {
    setActionHint(msg);
    if (actionHintTimerRef.current) clearTimeout(actionHintTimerRef.current);
    actionHintTimerRef.current = setTimeout(() => setActionHint(""), 2600);
  }, []);

  const persistTimelineNow = useCallback(
    async (timeline: Record<string, unknown> | null) => {
      if (!loggedIn) return;
      const nextTimeline = timeline && typeof timeline === "object" ? timeline : {};
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/timeline`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ timeline: nextTimeline })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `保存时间线失败 ${res.status}`);
      }
    },
    [getAuthHeaders, loggedIn, projectId]
  );

  const snapshotCurrentEditState = useCallback(
    (label: string) => {
      const timeline =
        project?.timeline_json && typeof project.timeline_json === "object"
          ? (project.timeline_json as Record<string, unknown>)
          : null;
      return { excludedIds: [...excludedRef.current].sort(), timeline, label };
    },
    [project?.timeline_json]
  );

  const pushEditHistory = useCallback(
    (label: string, opts?: { seekMs?: number | null }) => {
      if (historyApplyingRef.current) return;
      const snap = snapshotCurrentEditState(label);
      editUndoStackRef.current.push(snap);
      if (editUndoStackRef.current.length > 20) editUndoStackRef.current.shift();
      editRedoStackRef.current = [];
      const seekMs = opts?.seekMs != null && Number.isFinite(opts.seekMs) ? Math.max(0, Math.round(opts.seekMs)) : null;
      setHistoryActions((prev) => [{ id: `${Date.now()}-${Math.random()}`, label, at: Date.now(), seekMs, snapshot: snap }, ...prev].slice(0, 20));
    },
    [snapshotCurrentEditState]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`presto-speaker-names:${projectId}`);
      if (!raw) {
        setSpeakerNames({});
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed || {})) {
        const ix = Number(k);
        if (Number.isInteger(ix) && typeof v === "string" && v.trim()) next[ix] = v.trim();
      }
      setSpeakerNames(next);
    } catch {
      setSpeakerNames({});
    }
  }, [projectId]);

  const rawWords = useMemo(() => {
    const w = project?.transcript_normalized?.words;
    return Array.isArray(w) ? (w as ClipWord[]) : [];
  }, [project]);

  useEffect(() => {
    if (!rawWords.length) {
      setAudioSegments([]);
      return;
    }
    setAudioSegments((prev) => (prev.length ? prev : buildInitialAudioSegments(rawWords)));
  }, [rawWords]);

  useEffect(() => {
    if (!selectedSegmentId) return;
    if (audioSegments.some((seg) => seg.id === selectedSegmentId)) return;
    setSelectedSegmentId(null);
  }, [audioSegments, selectedSegmentId]);

  const words = useMemo(() => reorderWordsBySegments(rawWords, audioSegments), [rawWords, audioSegments]);
  const rawWordById = useMemo(() => new Map(rawWords.map((w) => [w.id, w])), [rawWords]);

  /** 口癖侧栏不再维护豁免表：聚合与建议均不按豁免过滤 */
  const noLexExempt = useMemo(() => new Set<string>() as ReadonlySet<string>, []);

  const lines = useMemo(() => groupSpeakerTurnLines(buildFlowUnits(words)), [words]);

  const silenceCutRanges = useMemo(() => {
    const tl = project?.timeline_json;
    const cutsRaw = tl && typeof tl === "object" ? (tl as { silence_cuts?: unknown }).silence_cuts : null;
    if (!Array.isArray(cutsRaw)) return [];
    const out: { start_ms: number; end_ms: number; cap_ms?: number | null }[] = [];
    for (const it of cutsRaw) {
      if (!it || typeof it !== "object") continue;
      const rec = it as { start_ms?: unknown; end_ms?: unknown; cap_ms?: unknown };
      const s = Number(rec.start_ms);
      const e = Number(rec.end_ms);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      const rawCap = rec.cap_ms == null ? null : Number(rec.cap_ms);
      const cap =
        rawCap == null || !Number.isFinite(rawCap) ? null : Math.max(0, Math.min(10_000, Math.round(rawCap)));
      out.push({ start_ms: Math.round(s), end_ms: Math.round(e), cap_ms: cap });
    }
    return out;
  }, [project?.timeline_json]);

  const silenceCutKeySet = useMemo(
    () => new Set(silenceCutRanges.map((x) => `sil:${Math.round(x.start_ms)}-${Math.round(x.end_ms)}`)),
    [silenceCutRanges]
  );

  /** 有删词或静音压缩即需剪辑试听（与导出同算法） */
  const needsEditedPreview = excluded.size > 0 || silenceCutRanges.length > 0;

  const editedPreviewFingerprint = useMemo(() => {
    const pause = project?.export_pause_policy;
    const pauseKey =
      pause && typeof pause === "object" && pause.enabled
        ? `${pause.long_gap_ms ?? ""}:${pause.cap_ms ?? ""}`
        : "off";
    return JSON.stringify({
      excluded: [...excluded].sort(),
      cuts: silenceCutRanges.map((c) => `${c.start_ms}-${c.end_ms}-${c.cap_ms ?? 0}`),
      pause: pauseKey,
      lameQ: lameQFromExportOptions(
        (project?.export_options ?? null) as import("../../lib/clipExportQuality").ClipExportOptions | null
      )
    });
  }, [excluded, silenceCutRanges, project?.export_pause_policy, project?.export_options]);

  const audioEvents = useMemo(() => {
    const tl = project?.timeline_json;
    const raw = tl && typeof tl === "object" ? (tl as { audio_events?: unknown }).audio_events : null;
    if (!Array.isArray(raw)) return [];
    const out: {
      id: string;
      start_ms: number;
      end_ms: number;
      label: string;
      confidence: number | null;
      action: "keep" | "cut" | "duck";
    }[] = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const rec = it as {
        id?: unknown;
        start_ms?: unknown;
        end_ms?: unknown;
        label?: unknown;
        confidence?: unknown;
        action?: unknown;
      };
      const s = Number(rec.start_ms);
      const e = Number(rec.end_ms);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      const label = String(rec.label || "").trim() || "noise";
      const actionRaw = String(rec.action || "keep").toLowerCase();
      const action: "keep" | "cut" | "duck" =
        actionRaw === "cut" ? "cut" : actionRaw === "duck" ? "duck" : "keep";
      const confRaw = rec.confidence == null ? null : Number(rec.confidence);
      out.push({
        id: String(rec.id || `${label}-${Math.round(s)}-${Math.round(e)}`),
        start_ms: Math.round(s),
        end_ms: Math.round(e),
        label,
        confidence: confRaw != null && Number.isFinite(confRaw) ? confRaw : null,
        action
      });
    }
    return out;
  }, [project?.timeline_json]);

  const renameSpeaker = useCallback(
    (speaker: number, nextName: string) => {
      const name = nextName.trim();
      setSpeakerNames((prev) => {
        const next = { ...prev };
        if (!name) delete next[speaker];
        else next[speaker] = name;
        try {
          localStorage.setItem(`presto-speaker-names:${projectId}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [projectId]
  );

  const upsertSilenceCut = useCallback(
    async (startMs: number, endMs: number, opts?: { remove?: boolean; capMs?: number | null }) => {
      const key = `sil:${Math.round(startMs)}-${Math.round(endMs)}`;
      const prevTimeline = project?.timeline_json && typeof project.timeline_json === "object" ? project.timeline_json : {};
      const normalizedCap =
        opts?.capMs == null ? null : Math.max(0, Math.min(10_000, Math.round(Number(opts.capMs) || 0)));
      const nextRanges = (() => {
        const kept = silenceCutRanges.filter(
          (x) => !(Math.round(x.start_ms) === Math.round(startMs) && Math.round(x.end_ms) === Math.round(endMs))
        );
        if (opts?.remove) return kept;
        return [
          ...kept,
          { start_ms: Math.round(startMs), end_ms: Math.round(endMs), cap_ms: normalizedCap }
        ];
      })();
      const nextTimeline = {
        ...prevTimeline,
        silence_cuts: nextRanges
      };
      setProject((prev) => (prev ? { ...prev, timeline_json: nextTimeline } : prev));
      try {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/timeline`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ timeline: nextTimeline })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存静音裁剪失败 ${res.status}`);
        }
      } catch (e) {
        setProject((prev) => (prev ? { ...prev, timeline_json: prevTimeline } : prev));
        setErr(String(e instanceof Error ? e.message : e));
      }
    },
    [getAuthHeaders, project?.timeline_json, projectId, silenceCutRanges]
  );

  const toggleSilenceCut = useCallback(
    async (startMs: number, endMs: number) => {
      pushEditHistory("静音裁剪切换", { seekMs: startMs });
      const key = `sil:${Math.round(startMs)}-${Math.round(endMs)}`;
      const removing = silenceCutKeySet.has(key);
      await upsertSilenceCut(startMs, endMs, removing ? { remove: true } : { capMs: 0 });
      pushActionHint(removing ? "静音恢复保留" : "静音已剪掉");
    },
    [pushActionHint, pushEditHistory, silenceCutKeySet, upsertSilenceCut]
  );

  const setSilenceCapMs = useCallback(
    async (startMs: number, endMs: number, capMs: number) => {
      pushEditHistory("静音 cap 调整", { seekMs: startMs });
      await upsertSilenceCut(startMs, endMs, { capMs });
      pushActionHint(`静音已缩短到 ${capMs}ms`);
    },
    [pushActionHint, pushEditHistory, upsertSilenceCut]
  );

  const setAudioEventAction = useCallback(
    async (eventId: string, nextAction: "keep" | "cut" | "duck") => {
      pushEditHistory(`事件设为 ${nextAction.toUpperCase()}`, {
        seekMs: audioEvents.find((ev) => ev.id === eventId)?.start_ms ?? null
      });
      const prevTimeline = project?.timeline_json && typeof project.timeline_json === "object" ? project.timeline_json : {};
      const prevEvents = audioEvents;
      const nextEvents = prevEvents.map((ev) => (ev.id === eventId ? { ...ev, action: nextAction } : ev));
      const nextTimeline = {
        ...prevTimeline,
        audio_events: nextEvents
      };
      setProject((prev) => (prev ? { ...prev, timeline_json: nextTimeline } : prev));
      try {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/timeline`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ timeline: nextTimeline })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存事件策略失败 ${res.status}`);
        }
      } catch (e) {
        setProject((prev) => (prev ? { ...prev, timeline_json: prevTimeline } : prev));
        setErr(String(e instanceof Error ? e.message : e));
        return;
      }
      pushActionHint(`事件动作已设为 ${nextAction.toUpperCase()}`);
    },
    [audioEvents, getAuthHeaders, project?.timeline_json, projectId, pushActionHint, pushEditHistory]
  );

  const batchSetAudioEventAction = useCallback(
    async (label: string, nextAction: "keep" | "cut" | "duck") => {
      pushEditHistory(`${label} 批量设为 ${nextAction.toUpperCase()}`, {
        seekMs: audioEvents.find((ev) => ev.label === label)?.start_ms ?? null
      });
      const prevTimeline = project?.timeline_json && typeof project.timeline_json === "object" ? project.timeline_json : {};
      const nextEvents = audioEvents.map((ev) => (ev.label === label ? { ...ev, action: nextAction } : ev));
      const nextTimeline = { ...prevTimeline, audio_events: nextEvents };
      setProject((prev) => (prev ? { ...prev, timeline_json: nextTimeline } : prev));
      try {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/timeline`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ timeline: nextTimeline })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `批量保存事件策略失败 ${res.status}`);
        }
      } catch (e) {
        setProject((prev) => (prev ? { ...prev, timeline_json: prevTimeline } : prev));
        setErr(String(e instanceof Error ? e.message : e));
        return;
      }
      pushActionHint(`${label} 已批量设为 ${nextAction.toUpperCase()}`);
    },
    [audioEvents, getAuthHeaders, project?.timeline_json, projectId, pushActionHint, pushEditHistory]
  );

  const analyzeAudioEvents = useCallback(async () => {
    if (audioEventsAnalyzeBusy) return;
    setAudioEventsAnalyzeBusy(true);
    setAudioEventsAnalyzeHint("已提交分析任务，正在等待结果…");
    try {
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio-events/analyze`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `事件分析提交失败 ${res.status}`);
      }
      await new Promise((r) => window.setTimeout(r, 1800));
      const refresh = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const refreshData = (await refresh.json().catch(() => ({}))) as {
        success?: boolean;
        project?: ClipProjectRow;
      };
      if (refresh.ok && refreshData.success !== false && refreshData.project) {
        setProject(refreshData.project);
      }
      setAudioEventsAnalyzeHint("事件分析任务已提交，若未更新可稍后再次刷新。");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      setAudioEventsAnalyzeHint("事件分析提交失败，请稍后重试。");
    } finally {
      setAudioEventsAnalyzeBusy(false);
    }
  }, [audioEventsAnalyzeBusy, getAuthHeaders, projectId]);

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
    const ticRaw = collectVerbalTicWordIds(words, excluded, noLexExempt);
    const tic =
      dismissedRoughKeys.size === 0
        ? ticRaw
        : ticRaw.filter((id) => {
            const w = words.find((x) => x.id === id);
            if (!w) return true;
            const dk = verbalTicRowDismissId(w, noLexExempt);
            return !dk || !dismissedRoughKeys.has(dk);
          });
    const q = scriptSearch.trim();
    if (!q) return new Set(tic);
    return new Set([...tic, ...searchHlWordIds]);
  }, [words, excluded, noLexExempt, scriptSearch, searchHlWordIds, dismissedRoughKeys]);

  const transcriptSilenceCards = useMemo(() => {
    const segs = silenceSegments;
    if (!Array.isArray(segs) || !segs.length) return [];
    const threshold = 2500;
    const rows: {
      start: number;
      end: number;
      dur: number;
      key: string;
      cut: boolean;
      capMs: number | null;
      jumpWordId: string | null;
    }[] = [];
    for (const s of segs) {
      const start = Number(s.start_ms);
      const end = Number(s.end_ms);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const dur = end - start;
      if (dur < threshold) continue;
      const key = `sil:${Math.round(start)}-${Math.round(end)}`;
      rows.push({
        start: Math.round(start),
        end: Math.round(end),
        dur,
        key,
        cut: silenceCutKeySet.has(key),
        capMs: (silenceCutRanges.find((x) => `sil:${Math.round(x.start_ms)}-${Math.round(x.end_ms)}` === key)?.cap_ms ??
          null) as number | null,
        jumpWordId: firstWordIdAtOrAfterMs(words, end, excluded)
      });
    }
    return rows.slice(0, 24);
  }, [excluded, silenceCutKeySet, silenceCutRanges, silenceSegments, words]);

  const transcriptAudioEventCards = useMemo(() => {
    return audioEvents
      .map((ev) => ({
        id: ev.id,
        start: ev.start_ms,
        end: ev.end_ms,
        label: ev.label,
        action: ev.action,
        jumpWordId: firstWordIdAtOrAfterMs(words, ev.end_ms, excluded)
      }))
      .slice(0, 80);
  }, [audioEvents, excluded, words]);

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
  const focusedSpeakerWordIds = useMemo(() => {
    if (!speakerFocusSet.size) return [] as string[];
    const ids: string[] = [];
    for (const line of lines) {
      if (!speakerFocusSet.has(line.speaker)) continue;
      for (const unit of line.units) {
        if (unit.kind === "single") ids.push(unit.word.id);
        else ids.push(...unit.words.map((w) => w.id));
      }
    }
    return ids;
  }, [lines, speakerFocusSet]);
  const focusedSpeakerExcludedIds = useMemo(
    () => focusedSpeakerWordIds.filter((id) => excluded.has(id)),
    [excluded, focusedSpeakerWordIds]
  );
  const transcriptSpeakerFilterSet = useMemo(
    () => (onlySelectedSpeakers ? speakerFocusSet : null),
    [onlySelectedSpeakers, speakerFocusSet]
  );
  const formatHistoryTime = useCallback((ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
    } catch {
      return "";
    }
  }, []);

  const estimatedDurationFromBytesMs = useMemo(() => {
    const b = project?.audio_size_bytes;
    if (typeof b !== "number" || !Number.isFinite(b) || b <= 0) return null;
    return Math.round((b * 8 * 1000) / 128_000);
  }, [project?.audio_size_bytes]);

  const durationMs = useMemo(() => {
    const d = project?.transcript_normalized?.duration_ms;
    if (typeof d === "number" && d > 0) return d;
    if (!words.length) {
      const est = estimatedDurationFromBytesMs;
      if (est != null && est > 0) return est;
      return null;
    }
    return Math.max(...words.map((w) => w.e_ms), 0);
  }, [project, words, estimatedDurationFromBytesMs]);

  const builtRuleSuggestions = useMemo(
    () => buildClipEditSuggestions(words, excluded, noLexExempt),
    [words, excluded, noLexExempt]
  );
  const [reviewedRuleSuggestions, setReviewedRuleSuggestions] = useState<ClipEditSuggestion[] | null>(null);

  useEffect(() => {
    setReviewedRuleSuggestions(null);
  }, [projectId, words, excluded]);

  useEffect(() => {
    if (project?.transcription_status !== "succeeded") {
      setReviewedRuleSuggestions(null);
      return;
    }
    const { items, indices } = buildRuleVerbalReviewRequest(builtRuleSuggestions);
    if (items.length === 0) {
      setReviewedRuleSuggestions(builtRuleSuggestions);
      return;
    }
    let cancelled = false;
    const tid = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await pageFetch(
            `/api/clip/projects/${encodeURIComponent(projectId)}/verbal-suggestion-review`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json", ...getAuthHeaders() },
              body: JSON.stringify({ items })
            }
          );
          const data = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            items?: LlmSuggestionApiItem[];
            detail?: string;
          };
          if (!res.ok || data.success === false || !Array.isArray(data.items) || data.items.length !== items.length) {
            if (!cancelled) setReviewedRuleSuggestions(builtRuleSuggestions);
            return;
          }
          const merged = mergeRuleVerbalReviewResponse(builtRuleSuggestions, indices, data.items);
          if (!cancelled) setReviewedRuleSuggestions(merged);
        } catch {
          if (!cancelled) setReviewedRuleSuggestions(builtRuleSuggestions);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [builtRuleSuggestions, projectId, project?.transcription_status, getAuthHeaders]);

  const editSuggestions = reviewedRuleSuggestions ?? builtRuleSuggestions;
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
    autoStructuredSuggestionRequestedRef.current = false;
  }, [projectId]);

  useEffect(() => {
    if (usePrdLayout) setTranscriptFullscreen(false);
  }, [usePrdLayout]);

  useEffect(() => {
    setDismissedRoughKeys(readRoughDismissedSet(projectId));
  }, [projectId]);

  const postSuggestionFeedback = useCallback(
    async (event: Record<string, unknown>) => {
      try {
        await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/suggestion-feedback`, {
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
      if (transcriptUsesEditedPreviewRef.current) {
        setPlaybackMs(approximateMasterTimelineMs(words, excludedRef.current, raw));
        return;
      }
      if (rawWithinFocusWordPlaybackHold(words, excludedRef.current, focusedWordIdRef.current, raw)) {
        setPlaybackMs(raw);
        return;
      }
      if (typeof performance !== "undefined" && performance.now() < playbackExcludedBypassUntilRef.current) {
        setPlaybackMs(raw);
        return;
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
    const friendly = friendlyWaveformError(msg);
    const now = Date.now();
    const prev = waveformLoadErrDedupRef.current;
    if (prev.msg === friendly && now - prev.at < 2500) return;
    waveformLoadErrDedupRef.current = { msg: friendly, at: now };
    setWaveformErr(friendly);
  }, []);

  const handleWaveformPlayState = useCallback((playing: boolean) => {
    setWaveformPlaying(playing);
  }, []);

  const snapSeekMs = useCallback((seekMs: number) => snapMsNearWordEdges(words, seekMs, 140), [words]);
  const audioMergeBusy =
    project?.audio_merge_status === "queued" || project?.audio_merge_status === "running";
  const segmentEditLocked =
    actionBusy ||
    insertingSegmentAudio ||
    audioMergeBusy ||
    project?.transcription_status === "running" ||
    project?.transcription_status === "queued" ||
    project?.export_status === "running" ||
    project?.export_status === "queued";

  const audioStagingEntries = useMemo(() => {
    const src = project?.audio_source_segments;
    const st = project?.audio_staging_keys;
    if (Array.isArray(src) && src.length > 0) return src;
    return Array.isArray(st) ? st : [];
  }, [project?.audio_source_segments, project?.audio_staging_keys]);

  const sourceMaterialKeys = useMemo(
    () => audioStagingEntries.map((e) => String(e.key || "").trim()).filter(Boolean),
    [audioStagingEntries]
  );

  useLayoutEffect(() => {
    setStagingTranscribeSelectedKeys((prev) => {
      const keySet = new Set(sourceMaterialKeys);
      const kept = prev.filter((k) => keySet.has(k));
      const added = sourceMaterialKeys.filter((k) => !kept.includes(k));
      const next = [...kept, ...added];
      if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev;
      return next;
    });
  }, [sourceMaterialKeys]);

  const mergedObjectKey = useMemo(() => String(project?.audio_object_key ?? "").trim(), [project?.audio_object_key]);

  /** 转写稿面上各素材 object_key 对应分段时长（seg_key），用于素材列表与播放器对齐 */
  const segmentDurationMsByKey = useMemo(() => maxSegDurationMsByKeyFromWords(words), [words]);

  /** 与素材列表一致：先按整稿时长均分，否则按各段 size_bytes 粗估再均分缺省段 */
  const approxSegmentDurationMs = useMemo(() => {
    if (audioStagingEntries.length === 0) return null;
    if (durationMs != null && durationMs > 0) {
      return Math.round(durationMs / audioStagingEntries.length);
    }
    const sumBytesOnly = sumStagingEntriesDurationMs(audioStagingEntries, null);
    if (sumBytesOnly > 0) {
      return Math.round(sumBytesOnly / audioStagingEntries.length);
    }
    return null;
  }, [audioStagingEntries, durationMs]);

  const stagingPerKeyFallbackMs = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of audioStagingEntries) {
      const k = String(e.key || "").trim();
      if (!k) continue;
      const dw = segmentDurationMsByKey[k];
      if (typeof dw === "number" && dw > 0) {
        m[k] = dw;
        continue;
      }
      const d = perStagingEntryDurationMs(e, approxSegmentDurationMs);
      if (d > 0) m[k] = d;
    }
    return m;
  }, [audioStagingEntries, approxSegmentDurationMs, segmentDurationMsByKey]);

  const materialSummedDurationMs = useMemo(() => {
    const transcribedOk = project?.transcription_status === "succeeded";
    let s = 0;
    for (const e of audioStagingEntries) {
      const k = String(e.key || "").trim();
      if (!k) continue;
      const dw = segmentDurationMsByKey[k];
      if (typeof dw === "number" && dw > 0) {
        s += dw;
        continue;
      }
      if (transcribedOk && approxSegmentDurationMs != null && approxSegmentDurationMs > 0) {
        s += approxSegmentDurationMs;
        continue;
      }
      s += perStagingEntryDurationMs(e, approxSegmentDurationMs);
    }
    return s;
  }, [
    audioStagingEntries,
    segmentDurationMsByKey,
    project?.transcription_status,
    approxSegmentDurationMs
  ]);

  const virtualAudioCues = useMemo(
    () =>
      buildVirtualAudioCues(
        projectId,
        audioStagingEntries,
        words,
        project?.transcript_normalized?.duration_ms ?? 0,
        stagingPerKeyFallbackMs
      ),
    [projectId, audioStagingEntries, words, project?.transcript_normalized?.duration_ms, stagingPerKeyFallbackMs]
  );

  const useVirtualMultiSegmentPlayback = mergedObjectKey.length === 0 && audioStagingEntries.length > 1;

  /** 多段虚拟拼接时：seek/口癖轮换排序用当前 cue 时间轴，避免与词上 s_ms 漂移不一致 */
  const jumpPlaybackCuesForSeek = useMemo(
    () => (useVirtualMultiSegmentPlayback && virtualAudioCues.length > 0 ? virtualAudioCues : null),
    [useVirtualMultiSegmentPlayback, virtualAudioCues]
  );

  /** 播放器底部：按素材顺序与时长比例的总进度分段条（与虚拟多段轨对齐） */
  const audioConsoleMaterialTimeline = useMemo(() => {
    if (audioStagingEntries.length < 1) return null;
    if (useVirtualMultiSegmentPlayback && virtualAudioCues.length > 0) {
      return {
        slices: virtualAudioCues.map((c) => ({ startMs: c.startGlobalMs, durationMs: c.durationMs })),
        totalMs: totalVirtualDurationMs(virtualAudioCues)
      };
    }
    const { slices, totalMs } = buildMaterialTimelineSlices(
      audioStagingEntries,
      words,
      durationMs ?? 0,
      stagingPerKeyFallbackMs
    );
    if (!slices.length || totalMs <= 0) return null;
    return { slices, totalMs };
  }, [
    audioStagingEntries,
    words,
    durationMs,
    useVirtualMultiSegmentPlayback,
    virtualAudioCues,
    stagingPerKeyFallbackMs
  ]);

  const audioConsoleScrubDurationMs = Math.max(
    durationMs ?? 0,
    audioConsoleMaterialTimeline?.totalMs ?? 0,
    materialSummedDurationMs
  );

  const singleSegmentFileUrl =
    mergedObjectKey.length === 0 && audioStagingEntries.length === 1
      ? `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/file?object_key=${encodeURIComponent(
          String(audioStagingEntries[0]!.key || "")
        )}`
      : undefined;

  /** 有合并主轨、或至少一段素材即可试听 */
  const hasServerAudio =
    mergedObjectKey.length > 0 ||
    audioStagingEntries.length > 0 ||
    Boolean(project?.has_audio) ||
    Boolean(project?.audio_download_url) ||
    Boolean(project?.audio_filename);

  const masterAudioUrl =
    mergedObjectKey.length > 0
      ? `/api/clip/projects/${encodeURIComponent(projectId)}/audio/file`
      : undefined;

  /** 稿面下方播放器：有删改时仅播剪辑试听 MP3，未生成完成前不回退原片 */
  const transcriptUsesEditedPreview = needsEditedPreview && wordchainPreviewOn && hasServerAudio;

  const transcriptPlayerAudioUrl = useMemo(() => {
    if (!hasServerAudio) return undefined;
    if (needsEditedPreview) {
      if (!wordchainPreviewOn) return undefined;
      return `/api/clip/projects/${encodeURIComponent(projectId)}/audio/wordchain-preview?cb=${wordchainPreviewNonce}`;
    }
    return masterAudioUrl ?? singleSegmentFileUrl;
  }, [
    hasServerAudio,
    needsEditedPreview,
    wordchainPreviewOn,
    projectId,
    wordchainPreviewNonce,
    masterAudioUrl,
    singleSegmentFileUrl
  ]);

  const useTranscriptVirtualPlayback = !needsEditedPreview && useVirtualMultiSegmentPlayback;

  const showTranscriptAudioTransport = hasServerAudio;

  useEffect(() => {
    transcriptUsesEditedPreviewRef.current = transcriptUsesEditedPreview;
    wordchainPreviewOnRef.current = wordchainPreviewOn;
    needsEditedPreviewRef.current = needsEditedPreview;
  }, [transcriptUsesEditedPreview, wordchainPreviewOn, needsEditedPreview]);

  useEffect(() => {
    setWaveformPlaying(false);
    setWaveformErr("");
  }, [transcriptPlayerAudioUrl]);

  const generateEditedPreview = useCallback(async (): Promise<boolean> => {
    if (!loggedIn || !hasServerAudio || project?.transcription_status !== "succeeded") return false;
    if (editedPreviewInFlightRef.current) return false;
    editedPreviewInFlightRef.current = true;
    setWordchainPreviewBusy(true);
    try {
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/wordchain-preview`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `剪辑试听生成失败 ${res.status}`);
      }
      setWordchainPreviewNonce((n) => n + 1);
      setWordchainPreviewOn(true);
      return true;
    } catch (e) {
      pendingPlayAfterPreviewRef.current = false;
      setErr(String(e instanceof Error ? e.message : e));
      return false;
    } finally {
      editedPreviewInFlightRef.current = false;
      setWordchainPreviewBusy(false);
    }
  }, [getAuthHeaders, hasServerAudio, loggedIn, project?.transcription_status, projectId]);

  /** 删改后使缓存试听失效；首次加载不重置，避免阻断已有试听状态 */
  useEffect(() => {
    if (!needsEditedPreview) {
      setWordchainPreviewOn(false);
      editedPreviewFingerprintRef.current = null;
      return;
    }
    const prev = editedPreviewFingerprintRef.current;
    editedPreviewFingerprintRef.current = editedPreviewFingerprint;
    if (prev !== null && prev !== editedPreviewFingerprint) {
      setWordchainPreviewOn(false);
    }
  }, [editedPreviewFingerprint, needsEditedPreview]);

  const handleTranscriptPlayPause = useCallback(async () => {
    if (!hasServerAudio) return;
    if (waveformPlaying) {
      waveformRef.current?.pause();
      return;
    }
    if (needsEditedPreview) {
      if (!loggedIn || project?.transcription_status !== "succeeded") return;
      if (!wordchainPreviewOn) {
        pendingPlayAfterPreviewRef.current = true;
        if (editedPreviewInFlightRef.current) return;
        await generateEditedPreview();
        return;
      }
    }
    void waveformRef.current?.play();
  }, [
    generateEditedPreview,
    hasServerAudio,
    loggedIn,
    needsEditedPreview,
    project?.transcription_status,
    waveformPlaying,
    wordchainPreviewOn
  ]);

  useEffect(() => {
    if (!pendingPlayAfterPreviewRef.current || !transcriptPlayerAudioUrl) return;
    pendingPlayAfterPreviewRef.current = false;
    const id = window.setTimeout(() => {
      void waveformRef.current?.play();
    }, 0);
    return () => window.clearTimeout(id);
  }, [transcriptPlayerAudioUrl]);

  const generateWordchainPreview = useCallback(async () => {
    if (!ensureLoggedInForAction("剪辑试听", "presto.wordchain.preview")) return;
    await generateEditedPreview();
  }, [ensureLoggedInForAction, generateEditedPreview]);

  /** 主音频 object_key 就绪即可拉静音分析，不依赖转写完成 */
  const loadSilenceSegments = useCallback(async () => {
    if (!hasServerAudio) {
      setSilenceSegments(null);
      return;
    }
    try {
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/silences`, {
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

  const resolveWaveformSeekMs = useCallback(
    (masterMs: number, word?: ClipWord) => {
      if (transcriptUsesEditedPreviewRef.current) {
        return approximateEditedTimelineMs(words, excludedRef.current, word?.s_ms ?? masterMs);
      }
      if (word) return clipWordGlobalPlaybackMs(word, jumpPlaybackCuesForSeek);
      return Math.round(masterMs);
    },
    [words, jumpPlaybackCuesForSeek]
  );

  const jumpToWordInTranscript = useCallback(
    (wid: string, opts?: { lineEndAutopause?: boolean }) => {
      focusedWordIdRef.current = wid;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      if (scriptSearch.trim()) {
        const ids = collectSubstringMatchWordIds(words, scriptSearch, excluded);
        if (ids.includes(wid)) setSearchHlWordIds(new Set([wid]));
      }
      setFocusedWordId(wid);
      transcriptRef.current?.scrollToWordId(wid);
      const w = words.find((x) => x.id === wid);
      if (w) {
        const g = resolveWaveformSeekMs(w.s_ms, w);
        waveformRef.current?.seekToMs(g, { snap: false });
      }
      if (opts?.lineEndAutopause && w && lines.length) {
        const endMaster = maxEndMsForLineContainingWordId(lines, wid, words);
        const g = resolveWaveformSeekMs(w.s_ms, w);
        if (transcriptUsesEditedPreviewRef.current && endMaster != null) {
          const endEdited = approximateEditedTimelineMs(words, excludedRef.current, endMaster);
          sentenceAutopauseEndMsRef.current = endEdited > g + 40 ? endEdited : null;
        } else {
          sentenceAutopauseEndMsRef.current = endMaster != null && endMaster > g + 40 ? endMaster : null;
        }
      } else {
        sentenceAutopauseEndMsRef.current = null;
      }
    },
    [words, scriptSearch, excluded, lines, resolveWaveformSeekMs]
  );

  const selectWordsFromRoughSheet = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return;
      const uniq = [...new Set(ids)];
      const first = uniq[0]!;
      focusedWordIdRef.current = first;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      setMultiSelectIds(new Set(uniq));
      setFocusedWordId(first);
      transcriptRef.current?.scrollToWordId(first);
      const w = words.find((x) => x.id === first);
      if (w) waveformRef.current?.seekToMs(resolveWaveformSeekMs(w.s_ms, w), { snap: false });
    },
    [words, resolveWaveformSeekMs]
  );

  const navigateScriptSearchHit = useCallback(
    (wid: string) => {
      focusedWordIdRef.current = wid;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      sentenceAutopauseEndMsRef.current = null;
      setSearchHlWordIds(new Set([wid]));
      setFocusedWordId(wid);
      transcriptRef.current?.scrollToWordId(wid);
      const w = words.find((x) => x.id === wid);
      if (w) {
        waveformRef.current?.seekToMs(resolveWaveformSeekMs(w.s_ms, w), { snap: false });
        void waveformRef.current?.play();
      }
    },
    [words, resolveWaveformSeekMs]
  );

  const selectAllScriptSearchHits = useCallback(() => {
    if (!scriptSearchHitIdsOrdered.length) return;
    setSearchHlWordIds(new Set(scriptSearchHitIdsOrdered));
    setMultiSelectIds(new Set(scriptSearchHitIdsOrdered));
    leftDragMultiSelectRef.current = false;
    const last = scriptSearchHitIdsOrdered[scriptSearchHitIdsOrdered.length - 1]!;
    setFocusedWordId(last);
  }, [scriptSearchHitIdsOrdered]);

  const seekPreviewMs = useCallback(
    (ms: number) => {
      sentenceAutopauseEndMsRef.current = null;
      if (!Number.isFinite(ms)) return;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      const seekMs = resolveWaveformSeekMs(Math.round(ms));
      waveformRef.current?.seekToMs(seekMs, { snap: false });
      void waveformRef.current?.play();
    },
    [resolveWaveformSeekMs]
  );

  const pushSegmentHistory = useCallback((prev: EditorAudioSegment[]) => {
    segmentUndoStackRef.current.push(prev.map((s) => ({ ...s, wordIds: [...s.wordIds] })));
    if (segmentUndoStackRef.current.length > 80) segmentUndoStackRef.current.shift();
    segmentRedoStackRef.current = [];
  }, []);

  const splitAtCursor = useCallback(
    (mode: "split" | "left" | "right") => {
      if (segmentEditLocked) return;
      const cursorMs = Math.max(0, Math.round(waveformRef.current?.getCurrentTimeMs() ?? playbackMs));
      let didSplit = false;
      setAudioSegments((prev) => {
        let idx = prev.findIndex((s) => cursorMs >= s.startMs && cursorMs <= s.endMs);
        if (idx < 0) idx = prev.findIndex((s) => cursorMs >= s.startMs - 120 && cursorMs <= s.endMs + 120);
        if (idx < 0) return prev;
        const seg = prev[idx]!;
        const cutMs = Math.max(seg.startMs + 80, Math.min(seg.endMs - 80, cursorMs));
        const leftWordIds = seg.wordIds.filter((id) => (rawWordById.get(id)?.e_ms ?? 0) <= cutMs);
        const rightWordIds = seg.wordIds.filter((id) => (rawWordById.get(id)?.s_ms ?? 0) >= cutMs);
        const left: EditorAudioSegment = { ...seg, id: `${seg.id}-l-${cutMs}`, endMs: cutMs, wordIds: leftWordIds };
        const right: EditorAudioSegment = { ...seg, id: `${seg.id}-r-${cutMs}`, startMs: cutMs, wordIds: rightWordIds };
        const next = [...prev];
        if (mode === "split") {
          next.splice(idx, 1, left, right);
        } else if (mode === "left") {
          next.splice(idx, 1, left);
        } else {
          next.splice(idx, 1, right);
        }
        pushSegmentHistory(prev);
        if (mode === "left" || mode === "split") {
          const wid = left.wordIds[left.wordIds.length - 1];
          if (wid) setFocusedWordId(wid);
        }
        if (mode === "right" || mode === "split") {
          const wid = right.wordIds[0];
          if (wid) setFocusedWordId(wid);
        }
        didSplit = true;
        return normalizeSegmentTimeline(next);
      });
      pushActionHint(didSplit ? "切割成功" : "未命中可切割片段");
    },
    [
      playbackMs,
      pushActionHint,
      pushSegmentHistory,
      rawWordById,
      segmentEditLocked
    ]
  );

  const undoSegmentEdit = useCallback(() => {
    const snap = segmentUndoStackRef.current.pop();
    if (!snap) return;
    setAudioSegments((prev) => {
      segmentRedoStackRef.current.push(prev.map((s) => ({ ...s, wordIds: [...s.wordIds] })));
      return snap.map((s) => ({ ...s, wordIds: [...s.wordIds] }));
    });
  }, []);

  const uploadInsertedAudioAtBoundary = useCallback(
    async (file: File, boundaryIndex: number) => {
      if (!ensureLoggedInForAction("插入音频", "presto.insert.audio")) return;
      if (segmentEditLocked) return;
      setInsertingSegmentAudio(true);
      const durationFromFile = await new Promise<number>((resolve) => {
        const audioEl = document.createElement("audio");
        const objectUrl = URL.createObjectURL(file);
        audioEl.src = objectUrl;
        audioEl.onloadedmetadata = () => {
          const v = Number.isFinite(audioEl.duration) ? Math.round(audioEl.duration * 1000) : 3000;
          URL.revokeObjectURL(objectUrl);
          resolve(Math.max(500, v));
        };
        audioEl.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(3000);
        };
      });
      try {
        const stageRes = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/stage`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-clip-filename": encodeClipFilenameForHttpHeader(file.name || "segment.mp3", "segment.mp3"),
            ...getAuthHeaders()
          },
          body: file
        });
        const stageData = (await stageRes.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!stageRes.ok || stageData.success === false) {
          throw new Error(stageData.detail || `暂存失败 ${stageRes.status}`);
        }
        setAudioSegments((prev) => {
          const next = [...prev];
          const anchor = boundaryIndex <= 0 ? prev[0]?.startMs ?? 0 : prev[boundaryIndex - 1]?.endMs ?? 0;
          const seg: EditorAudioSegment = {
            id: `inserted-${Date.now()}`,
            startMs: anchor,
            endMs: anchor + durationFromFile,
            source: "inserted",
            transcribed: false,
            wordIds: []
          };
          next.splice(Math.max(0, Math.min(boundaryIndex, next.length)), 0, seg);
          pushSegmentHistory(prev);
          return normalizeSegmentTimeline(next);
        });
      } finally {
        setInsertingSegmentAudio(false);
      }
    },
    [ensureLoggedInForAction, getAuthHeaders, projectId, pushSegmentHistory, segmentEditLocked]
  );

  const transcriptionActive =
    project?.transcription_status === "running" || project?.transcription_status === "queued";
  const exportActive = project?.export_status === "running" || project?.export_status === "queued";
  const pendingInsertedSegments = useMemo(
    () => audioSegments.filter((s) => s.source === "inserted" && !s.transcribed),
    [audioSegments]
  );
  const segmentTimelineTotalMs = useMemo(
    () => (audioSegments.length ? Math.max(1, audioSegments[audioSegments.length - 1]!.endMs) : 1),
    [audioSegments]
  );
  const middleInsertBoundaries = useMemo(
    () =>
      audioSegments
        .map((seg, idx) => ({ idx, seg }))
        .slice(0, -1)
        .map(({ idx, seg }) => ({
          index: idx + 1,
          leftPct: Math.max(0, Math.min(100, (seg.endMs / segmentTimelineTotalMs) * 100))
        })),
    [audioSegments, segmentTimelineTotalMs]
  );
  const timelineSegments = useMemo(
    () =>
      audioSegments.map((seg, idx) => {
        const leftPct = Math.max(0, Math.min(100, (seg.startMs / segmentTimelineTotalMs) * 100));
        const widthPct = Math.max(1.4, ((seg.endMs - seg.startMs) / segmentTimelineTotalMs) * 100);
        return { seg, idx, leftPct, widthPct };
      }),
    [audioSegments, segmentTimelineTotalMs]
  );
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
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
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
      editUndoStackRef.current = [];
      editRedoStackRef.current = [];
      setHistoryActions([]);
      bumpExcludedHistory();
    } catch (e) {
      if (isAbortError(e) || pageAbortSignal.aborted) return;
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      if (!pageAbortSignal.aborted) setLoading(false);
    }
  }, [getAuthHeaders, projectId, pageAbortSignal, pageFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProjectTitle = useCallback(async () => {
    if (!project) return;
    if (!ensureLoggedInForAction("重命名工程", "presto.rename")) return;
    const nextTitle = projectTitleDraft.trim().slice(0, 200) || t("clip.defaultProjectTitle");
    setProjectTitleBusy(true);
    setErr("");
    try {
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: nextTitle })
      });
      const rawText = await res.text().catch(() => "");
      const data = ((() => {
        try {
          return rawText ? JSON.parse(rawText) : {};
        } catch {
          return {};
        }
      })()) as { success?: boolean; detail?: string; error?: string; project?: ClipProjectRow };
      if (!res.ok || data.success === false) {
        const detail = String(data.detail || data.error || "").trim();
        const hint = detail || rawText || `HTTP ${res.status}`;
        console.error("[clip][editor-rename] project rename failed", {
          projectId,
          method: "POST",
          status: res.status,
          statusText: res.statusText,
          response: rawText
        });
        throw new Error(`重命名失败（${res.status}）: ${hint}`);
      }
      setProject((prev) => (prev ? { ...prev, title: nextTitle } : prev));
      setProjectTitleEditing(false);
    } catch (e) {
      console.error("[clip][editor-rename] project rename exception", {
        projectId,
        method: "POST",
        error: String(e instanceof Error ? e.message : e)
      });
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setProjectTitleBusy(false);
    }
  }, [ensureLoggedInForAction, getAuthHeaders, project, projectId, projectTitleDraft, t]);

  useEffect(() => {
    const st = project?.transcription_status;
    const ex = project?.export_status;
    const mergeSt = project?.audio_merge_status;
    const mergeBusy = mergeSt === "running" || mergeSt === "queued";
    const txBusy = st === "running" || st === "queued";
    const exBusy = ex === "running" || ex === "queued";
    if (txBusy || exBusy || mergeBusy) {
      const busyPollMs = mergeBusy && !txBusy && !exBusy ? 2200 : 5500;
      const id = window.setInterval(() => {
        if (projectBusyPollVisibleRef.current) void load();
      }, busyPollMs);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [load, project?.transcription_status, project?.export_status, project?.audio_merge_status]);

  const persistExcludedNow = useCallback(
    async (next: Set<string>, opts?: { showSavingHint?: boolean }) => {
      if (!loggedIn) return;
      try {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ excluded_word_ids: [...next] })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存失败 ${res.status}`);
        }
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      }
      void opts;
    },
    [getAuthHeaders, loggedIn, projectId]
  );

  const scheduleSaveExcluded = useCallback(
    (next: Set<string>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persistExcludedNow(next, { showSavingHint: false }), 500);
    },
    [persistExcludedNow]
  );

  const applyEditSnapshot = useCallback(
    async (snap: { excludedIds: string[]; timeline: Record<string, unknown> | null }) => {
      historyApplyingRef.current = true;
      const nextExcluded = new Set(snap.excludedIds);
      setExcluded(nextExcluded);
      excludedRef.current = nextExcluded;
      scheduleSaveExcluded(nextExcluded);
      setProject((prev) => (prev ? { ...prev, timeline_json: snap.timeline ?? {} } : prev));
      try {
        await persistTimelineNow(snap.timeline);
      } finally {
        historyApplyingRef.current = false;
      }
    },
    [persistTimelineNow, scheduleSaveExcluded]
  );

  const restoreHistoryAction = useCallback(
    async (id: string) => {
      const hit = historyActions.find((x) => x.id === id);
      if (!hit) return;
      editUndoStackRef.current.push(snapshotCurrentEditState(`恢复前:${hit.label}`));
      if (editUndoStackRef.current.length > 20) editUndoStackRef.current.shift();
      editRedoStackRef.current = [];
      await applyEditSnapshot(hit.snapshot);
      pushActionHint(`已恢复到：${hit.label}`);
    },
    [applyEditSnapshot, historyActions, pushActionHint, snapshotCurrentEditState]
  );

  /** Word 式 Ctrl+S：立即落盘当前删词状态（跳过防抖） */
  const flushExcludedSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persistExcludedNow(new Set(excludedRef.current), { showSavingHint: true });
  }, [persistExcludedNow]);

  const undoExcluded = useCallback(() => {
    const prev = editUndoStackRef.current.pop();
    if (!prev) return;
    editRedoStackRef.current.push(snapshotCurrentEditState(`redo:${prev.label}`));
    void applyEditSnapshot(prev);
    bumpExcludedHistory();
    pushActionHint(`已撤销：${prev.label}`);
  }, [applyEditSnapshot, pushActionHint, snapshotCurrentEditState]);

  const redoExcluded = useCallback(() => {
    const nxt = editRedoStackRef.current.pop();
    if (!nxt) return;
    editUndoStackRef.current.push(snapshotCurrentEditState(`undo:${nxt.label}`));
    void applyEditSnapshot(nxt);
    bumpExcludedHistory();
    pushActionHint(`已重做：${nxt.label}`);
  }, [applyEditSnapshot, pushActionHint, snapshotCurrentEditState]);

  const markManyExcluded = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return;
      if (ids.length >= 50 && !window.confirm(`即将删除 ${ids.length} 个词，是否继续？`)) return;
      pushEditHistory(`删除 ${ids.length} 词`, {
        seekMs: words.find((w) => w.id === ids[0])?.s_ms ?? null
      });
      setExcluded((prev) => {
        excludedUndoStack.current.push([...prev].sort());
        excludedRedoStack.current = [];
        const n = new Set(prev);
        for (const id of ids) n.add(id);
        scheduleSaveExcluded(n);
        return n;
      });
      bumpExcludedHistory();
      pushActionHint(`已删除 ${ids.length} 个词`);
    },
    [pushActionHint, pushEditHistory, scheduleSaveExcluded, words]
  );

  const deleteAllScriptSearchHits = useCallback(() => {
    if (!searchAllHitsSelected || !scriptSearchHitIdsOrdered.length) return;
    if (
      scriptSearchHitIdsOrdered.length >= 50 &&
      !window.confirm(`即将删除 ${scriptSearchHitIdsOrdered.length} 个搜索命中词，是否继续？`)
    )
      return;
    markManyExcluded(scriptSearchHitIdsOrdered);
  }, [searchAllHitsSelected, scriptSearchHitIdsOrdered, markManyExcluded]);

  const markManyRestored = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return;
      pushEditHistory(`恢复 ${ids.length} 词`, {
        seekMs: words.find((w) => w.id === ids[0])?.s_ms ?? null
      });
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
    [pushEditHistory, scheduleSaveExcluded, words]
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
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        const ae = document.activeElement as HTMLElement | null;
        if (isTypingTarget(ae)) return;
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        const ae = document.activeElement as HTMLElement | null;
        if (isTypingTarget(ae)) return;
        e.preventDefault();
        e.stopPropagation();
        if (hasServerAudio) void handleTranscriptPlayPause();
        return;
      }
      if (e.key === "Escape" && multiSelectIds.size > 0) {
        e.preventDefault();
        setMultiSelectIds(new Set());
        leftDragMultiSelectRef.current = false;
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const el = document.activeElement as HTMLElement | null;
        if (isTypingTarget(el)) return;
        const silenceEl = el?.closest?.("[data-silence-start][data-silence-end]") as HTMLElement | null;
        if (silenceEl) {
          const s = Number(silenceEl.getAttribute("data-silence-start"));
          const ee = Number(silenceEl.getAttribute("data-silence-end"));
          if (Number.isFinite(s) && Number.isFinite(ee) && ee > s) {
            e.preventDefault();
            void toggleSilenceCut(Math.round(s), Math.round(ee));
            return;
          }
        }
        const audioEventEl = el?.closest?.("[data-audio-event-id]") as HTMLElement | null;
        if (audioEventEl) {
          const eventId = String(audioEventEl.getAttribute("data-audio-event-id") || "").trim();
          if (eventId) {
            if (e.key === "Backspace" || e.key === "Delete") {
              e.preventDefault();
              void setAudioEventAction(eventId, "cut");
              return;
            }
          }
        }

        const bulk = multiSelectIds.size > 0 ? [...multiSelectIds] : [];
        if (bulk.length > 0) {
          if (bulk.length >= 50 && !window.confirm(`即将删除 ${bulk.length} 个词，是否继续？`)) return;
          e.preventDefault();
          pushEditHistory(`删除 ${bulk.length} 词`, {
            seekMs: words.find((w) => w.id === bulk[0])?.s_ms ?? null
          });
          let keptCount = 0;
          setExcluded((prev) => {
            excludedUndoStack.current.push([...prev].sort());
            excludedRedoStack.current = [];
            const n = new Set(prev);
            for (const id of bulk) {
              if (!n.has(id)) keptCount += 1;
              n.add(id);
            }
            scheduleSaveExcluded(n);
            return n;
          });
          bumpExcludedHistory();
          setMultiSelectIds(new Set());
          leftDragMultiSelectRef.current = false;
          setDeleteFeedback(
            t("presto.flow.deleteFeedbackBatch").replace("{count}", String(Math.max(1, keptCount)))
          );
          if (deleteFeedbackTimerRef.current) clearTimeout(deleteFeedbackTimerRef.current);
          deleteFeedbackTimerRef.current = setTimeout(() => setDeleteFeedback(""), 3000);
          return;
        }

        const widFromDom = el?.getAttribute("data-word-id") || el?.dataset?.wordId;
        const wid = widFromDom || focusedWordId;
        if (wid) {
          e.preventDefault();
          const ex = excludedRef.current;
          const ordered = words;
          const w = ordered.find((x) => x.id === wid) ?? words.find((x) => x.id === wid);
          if (!w || ex.has(w.id)) return;
          pushEditHistory("删除 1 词", { seekMs: w.s_ms });
          setExcluded((prev) => {
            excludedUndoStack.current.push([...prev].sort());
            excludedRedoStack.current = [];
            const n = new Set(prev);
            n.add(w.id);
            scheduleSaveExcluded(n);
            return n;
          });
          bumpExcludedHistory();
          setMultiSelectIds(new Set());
          leftDragMultiSelectRef.current = false;
          setDeleteFeedback(t("presto.flow.deleteFeedbackSingle"));
          if (deleteFeedbackTimerRef.current) clearTimeout(deleteFeedbackTimerRef.current);
          deleteFeedbackTimerRef.current = setTimeout(() => setDeleteFeedback(""), 3000);
          const next = ordered.find((x) => !ex.has(x.id) && x.s_ms >= w.e_ms + 1) || ordered.find((x) => !ex.has(x.id));
          if (next) {
            setFocusedWordId(next.id);
            transcriptRef.current?.scrollToWordId(next.id);
          }
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
        leftDragMultiSelectRef.current = true;
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
        leftDragMultiSelectRef.current = true;
        transcriptRef.current?.scrollToWordId(w1.id);
        return;
      }

      if (e.shiftKey && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        const ordered = words;
        if (!ordered.length) return;
        e.preventDefault();
        const dir = e.code === "ArrowLeft" ? -1 : 1;
        let anchor = rangeAnchorWordIdRef.current || focusedWordId || ordered[0]!.id;
        if (ordered.findIndex((w) => w.id === anchor) < 0) anchor = focusedWordId || ordered[0]!.id;
        const focus = focusedWordId || anchor;
        const ix = ordered.findIndex((w) => w.id === focus);
        if (ix < 0) return;
        const j = ix + dir;
        if (j < 0 || j >= ordered.length) return;
        const nw = ordered[j]!;
        const ids = wordIdsBetweenInclusive(ordered, anchor, nw.id);
        setFocusedWordId(nw.id);
        setMultiSelectIds(new Set(ids.length ? ids : [nw.id]));
        leftDragMultiSelectRef.current = true;
        transcriptRef.current?.scrollToWordId(nw.id);
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
        leftDragMultiSelectRef.current = false;
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
          leftDragMultiSelectRef.current = true;
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
        leftDragMultiSelectRef.current = true;
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
      } else if (e.key === "k" || e.key === "K" || e.key === "d" || e.key === "D" || e.key === "u" || e.key === "U") {
        const elEvt = (document.activeElement as HTMLElement | null)?.closest?.("[data-audio-event-id]") as HTMLElement | null;
        const eventId = String(elEvt?.getAttribute("data-audio-event-id") || "").trim();
        if (!eventId) return;
        e.preventDefault();
        if (e.key === "k" || e.key === "K") void setAudioEventAction(eventId, "keep");
        else if (e.key === "u" || e.key === "U") void setAudioEventAction(eventId, "duck");
        else void setAudioEventAction(eventId, "cut");
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
    flushExcludedSave,
    toggleSilenceCut,
    setAudioEventAction,
    pushEditHistory,
    handleTranscriptPlayPause,
    t
  ]);

  const onRangeDragPointerDown = useCallback((w: ClipWord, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
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
    leftDragMultiSelectRef.current = true;

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
      leftDragMultiSelectRef.current = true;
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
    if (e.pointerType && e.pointerType !== "mouse") return;
    const anchor = rangeDragAnchorRef.current;
    if (!anchor || (e.buttons & 1) !== 1) return;
    rangeDragMovedRef.current = true;
    const ids = wordIdsBetweenInclusive(words, anchor, w.id);
    setMultiSelectIds(new Set(ids.length ? ids : [w.id]));
    setFocusedWordId(w.id);
    leftDragMultiSelectRef.current = true;
  }, [words]);

  useEffect(() => {
    const root = transcriptScrollElRef.current;
    if (!root) return;
    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      if (ev.button !== 0) return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      // Word blocks already have their own drag-selection handlers.
      if (target.closest("[data-word-id]")) return;
      const sx = ev.clientX;
      const sy = ev.clientY;
      let anchor: string | null = null;
      rangeDragMovedRef.current = false;
      const move = (mv: PointerEvent) => {
        if ((mv.buttons & 1) !== 1) return;
        if ((mv.clientX - sx) ** 2 + (mv.clientY - sy) ** 2 > 36) rangeDragMovedRef.current = true;
        const curId = findWordIdUnderPoint(mv.clientX, mv.clientY);
        if (!curId) return;
        if (!anchor) {
          anchor = curId;
          setMultiSelectIds(new Set([curId]));
          setFocusedWordId(curId);
          leftDragMultiSelectRef.current = true;
          return;
        }
        const ids = wordIdsBetweenInclusive(words, anchor, curId);
        setMultiSelectIds(new Set(ids.length ? ids : [curId]));
        setFocusedWordId(curId);
        leftDragMultiSelectRef.current = true;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [findWordIdUnderPoint, words]);

  const autoSaveSnapshot = useCallback(async () => {
    try {
      await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/snapshots`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          label: "自动快照",
          excluded_word_ids: [...excludedRef.current],
          timeline_json: project?.timeline_json ?? null
        })
      });
    } catch {
      /* ignore */
    }
  }, [getAuthHeaders, project?.timeline_json, projectId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void autoSaveSnapshot();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [autoSaveSnapshot]);

  useEffect(() => {
    if (multiSelectIds.size === 0) {
      setSelectionToolbar((p) => ({ ...p, visible: false }));
      return;
    }
    const nodes = [...multiSelectIds]
      .map((id) => document.querySelector(`[data-word-id="${id}"]`) as HTMLElement | null)
      .filter(Boolean) as HTMLElement[];
    if (!nodes.length) {
      setSelectionToolbar((p) => ({ ...p, visible: false }));
      return;
    }
    const rects = nodes.map((n) => n.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    setSelectionToolbar({ x: (left + right) / 2, y: Math.max(12, top - 8), visible: true });
  }, [multiSelectIds]);

  useEffect(() => {
    if (!selectionToolbar.visible) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (selectionToolbarRef.current?.contains(target)) return;
      setSelectionToolbar((p) => ({ ...p, visible: false }));
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [selectionToolbar.visible]);

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
        focusedWordIdRef.current = w.id;
        // 与「框选」保持同一语义：都视为范围选区
        leftDragMultiSelectRef.current = true;
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
        focusedWordIdRef.current = w.id;
        // 与「框选」保持同一语义：都视为范围选区
        leftDragMultiSelectRef.current = true;
        return;
      }
      rangeAnchorWordIdRef.current = w.id;
      setMultiSelectIds(new Set([w.id]));
      setFocusedWordId(w.id);
      focusedWordIdRef.current = w.id;
      // 左键单击单词后，Delete/Backspace 也按“选区删除”处理（单词选区）。
      leftDragMultiSelectRef.current = true;
      sentenceAutopauseEndMsRef.current = null;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      waveformRef.current?.seekToMs(resolveWaveformSeekMs(w.s_ms, w), { snap: false });
    },
    [focusedWordId, words, resolveWaveformSeekMs]
  );

  const deleteSelectionFromToolbar = useCallback(() => {
    const ids = [...multiSelectIds];
    if (!ids.length) return;
    if (ids.length >= 50 && !window.confirm(`即将删除 ${ids.length} 个词，是否继续？`)) return;
    markManyExcluded(ids);
  }, [markManyExcluded, multiSelectIds]);

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

  const startTranscribe = useCallback(async () => {
    if (!ensureLoggedInForAction("提交转写", "presto.transcribe")) return;
    setActionBusy(true);
    setErr("");
    try {
      const pendingInserted = pendingInsertedSegments;
      /** full / partial 均不传 transcribe_segment_keys：首次须识别全部缺失段才能拼稿；补转由服务端处理缺失分段。 */
      const payload: Record<string, unknown> =
        pendingInserted.length > 0
          ? {
              mode: "partial",
              segments: pendingInserted.map((seg) => ({
                id: seg.id,
                start_ms: seg.startMs,
                end_ms: seg.endMs
              }))
            }
          : { mode: "full" };
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/transcribe`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `提交转写失败 ${res.status}`);
      }
      if (pendingInserted.length > 0) {
        setAudioSegments((prev) =>
          prev.map((seg) =>
            seg.source === "inserted" ? { ...seg, transcribed: true } : seg
          )
        );
      }
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setActionBusy(false);
    }
  }, [ensureLoggedInForAction, pendingInsertedSegments, projectId, getAuthHeaders, load]);

  const reorderAudioSegment = useCallback(
    (segmentId: string, targetIndex: number) => {
      if (segmentEditLocked) return;
      setAudioSegments((prev) => {
        const from = prev.findIndex((s) => s.id === segmentId);
        if (from < 0) return prev;
        const to = Math.max(0, Math.min(targetIndex, prev.length - 1));
        if (from === to) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        if (!moved) return prev;
        next.splice(to, 0, moved);
        pushSegmentHistory(prev);
        return normalizeSegmentTimeline(next);
      });
      setSelectedSegmentId(segmentId);
    },
    [pushSegmentHistory, segmentEditLocked]
  );

  const focusSegment = useCallback(
    (segmentId: string, seekMsOverride?: number) => {
      const seg = audioSegments.find((s) => s.id === segmentId);
      if (!seg) return;
      setSelectedSegmentId(segmentId);
      const seekMs =
        typeof seekMsOverride === "number"
          ? Math.max(seg.startMs, Math.min(seg.endMs, Math.round(seekMsOverride)))
          : seg.startMs;
      if (typeof performance !== "undefined") {
        playbackExcludedBypassUntilRef.current = performance.now() + 1800;
      }
      waveformRef.current?.seekToMs(seekMs, { snap: false });
      const firstWordId = seg.wordIds.find((id) => rawWordById.has(id));
      if (firstWordId) {
        focusedWordIdRef.current = firstWordId;
        setFocusedWordId(firstWordId);
      }
    },
    [audioSegments, rawWordById]
  );

  const performExport = useCallback(async () => {
    if (!ensureLoggedInForAction("导出成片", "presto.export")) return;
    setActionBusy(true);
    setErr("");
    try {
      const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/export`, {
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
  }, [ensureLoggedInForAction, getAuthHeaders, projectId, load]);

  const downloadExportFile = useCallback(async () => {
    if (!project) return;
    try {
      await downloadClipExportMp3({
        projectId,
        title: project.title || projectId,
        headers: getAuthHeaders()
      });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders, project, projectId]);

  const handleExportClick = useCallback(() => {
    if (!ensureLoggedInForAction("导出成片", "presto.export")) return;
    if (project?.export_status === "succeeded") {
      void downloadExportFile();
      return;
    }
    void performExport();
  }, [downloadExportFile, ensureLoggedInForAction, performExport, project?.export_download_url, project?.export_status]);

  const exportButtonLabel = useMemo(() => {
    if (!project) return t("clip.editor.export");
    if (project.export_status === "queued") return t("clip.editor.exportStatus.queued");
    if (project.export_status === "running") return t("clip.editor.exportStatus.running");
    if (project.export_status === "succeeded") {
      return t("clip.editor.downloadExport");
    }
    return t("clip.editor.export");
  }, [project, t]);

  const exportButtonDisabled = useMemo(() => {
    if (!project) return true;
    if (actionBusy || audioMergeBusy) return true;
    if (project.transcription_status !== "succeeded") return true;
    if (exportActive) return true;
    return false;
  }, [actionBusy, audioMergeBusy, exportActive, project]);

  useEffect(() => {
    if (!loggedIn) return;
    const action = consumePostAuthActionForCurrentPath([
      "presto.transcribe",
      "presto.export",
      "presto.wordchain.preview"
    ]);
    if (action === "presto.transcribe") {
      void startTranscribe();
    } else if (action === "presto.export") {
      void performExport();
    } else if (action === "presto.wordchain.preview") {
      void generateWordchainPreview();
    }
  }, [generateWordchainPreview, loggedIn, performExport, startTranscribe]);

  useEffect(() => {
    const cur = project?.export_status ?? null;
    const prev = prevExportStatusRef.current;
    prevExportStatusRef.current = cur;
    if (cur !== "succeeded") return;
    if (prev !== "running" && prev !== "queued") return;
    void downloadExportFile();
  }, [downloadExportFile, project?.export_status]);

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
        void performExport();
      }
    },
    [words, onKeepStutterFirst, scheduleSaveExcluded, postSuggestionFeedback, performExport]
  );

  const loadDeepseekStructured = useCallback(async () => {
    if (project?.transcription_status !== "succeeded") return;
    setLlmPhase("structured");
    setErr("");
    try {
      const requestStructured = async (maxWords: number) => {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/edit-suggestions`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ llm: true, mode: "structured", max_words: maxWords })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          items?: LlmSuggestionApiItem[];
          detail?: string;
        };
        return { res, data };
      };
      let { res, data } = await requestStructured(700);
      if (
        (!res.ok || data.success === false) &&
        (res.status === 504 || /504|网关超时|timed?\s*out/i.test(String(data.detail || "")))
      ) {
        ({ res, data } = await requestStructured(420));
      }
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

  useEffect(() => {
    if (project?.transcription_status !== "succeeded") return;
    if (autoStructuredSuggestionRequestedRef.current) return;
    autoStructuredSuggestionRequestedRef.current = true;
    void loadDeepseekStructured();
  }, [loadDeepseekStructured, project?.transcription_status]);

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
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/edit-suggestions`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            llm: true,
            mode: "expand",
            title: src.title,
            body: src.body,
            suggestion_id: src.suggestionId,
            max_words: 700
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

  const runClipPrdRepair = useCallback(
    async (kind: "ambient" | "voice_clarity" | "loudnorm") => {
      if (!project) return;
      const tSt = project.transcription_status;
      if (tSt === "running" || tSt === "queued") {
        setErr("转写进行中，请稍后再试修音");
        return;
      }
      if (!project.has_audio && !project.audio_download_url) {
        setErr("无主素材音频");
        return;
      }
      setPrdRepairBusyKind(kind);
      setErr("");
      try {
        const res = await pageFetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/repair`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ kind })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          project?: ClipProjectRow;
          detail?: string;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `修音失败 ${res.status}`);
        }
        if (data.project) setProject(data.project);
        await load();
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      } finally {
        setPrdRepairBusyKind("");
      }
    },
    [getAuthHeaders, load, project, projectId]
  );

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
        <Link href={WORKBENCH_PODCAST_CLIP_PATH} className="text-sm text-brand hover:underline">
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
        : workbenchTab === "search"
          ? t("presto.flow.drawer.tabSearch")
          : "变更历史";

  const showTranscriptFullscreen = !usePrdLayout && transcriptFullscreen;

  const roughCutDockProps = {
    projectId,
    project,
    words,
    jumpOrderCues: jumpPlaybackCuesForSeek,
    excluded,
    onMarkExcluded: markManyExcluded,
    onMarkRestored: markManyRestored,
    onProjectPatch: setProject,
    getAuthHeaders,
    onRefreshProject: load,
    onError: (msg: string) => setErr(msg),
    multiSelectIds,
    onSelectWordIdsForSheet: selectWordsFromRoughSheet,
    silenceSegments,
    onJumpWord: jumpToWordInTranscript,
    onSeekPreviewMs: seekPreviewMs,
    onRefreshSilences: loadSilenceSegments,
    silenceCutKeys: silenceCutKeySet,
    onToggleSilenceCut: (startMs: number, endMs: number) => {
      void toggleSilenceCut(startMs, endMs);
    },
    onSetSilenceCapMs: (startMs: number, endMs: number, capMs: number) => {
      void setSilenceCapMs(startMs, endMs, capMs);
    },
    roughCutSuggestions: roughPanelSuggestions,
    onExecuteSuggestion,
    dismissedRoughKeys,
    onToggleDismissRoughKey: toggleDismissRoughKey,
    outlineExpandBusy: llmPhase === "expand",
    onExpandOutline: (src: ClipOutlineSource) => {
      void loadDeepseekExpandOutline(src);
    },
    hasServerAudio,
    wordchainPreviewActive: wordchainPreviewOn,
    wordchainPreviewBusy,
    onGenerateWordchainPreview: () => {
      void generateWordchainPreview();
    },
    onExitWordchainPreview: () => setWordchainPreviewOn(false)
  };

  const prdHistoryPanel = (
    <section className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:bg-fill disabled:opacity-40"
          disabled={editUndoStackRef.current.length === 0}
          onClick={() => undoExcluded()}
        >
          撤销
        </button>
        <button
          type="button"
          className="rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:bg-fill disabled:opacity-40"
          disabled={editRedoStackRef.current.length === 0}
          onClick={() => redoExcluded()}
        >
          重做
        </button>
      </div>
      {historyActions.length === 0 ? (
        <p className="text-[11px] text-muted">暂无变更历史</p>
      ) : (
        <ul className="flex max-h-[min(68vh,28rem)] flex-col gap-1 overflow-y-auto">
          {historyActions.map((it) => (
            <li
              key={it.id}
              className={[
                "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] transition",
                selectedHistoryId === it.id
                  ? "border-brand/50 bg-brand/5"
                  : "border-line/80 bg-surface/70 hover:bg-fill/40"
              ].join(" ")}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-ink"
                title={it.label}
                onClick={() => setSelectedHistoryId((prev) => (prev === it.id ? null : it.id))}
              >
                <span className="mr-2 shrink-0 font-mono tabular-nums text-muted">{formatHistoryTime(it.at)}</span>
                <span>{it.label}</span>
              </button>
              <button
                type="button"
                disabled={it.seekMs == null}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:bg-fill disabled:opacity-40"
                onClick={() => {
                  if (it.seekMs == null) return;
                  seekPreviewMs(it.seekMs);
                }}
              >
                定位
              </button>
              {selectedHistoryId === it.id ? (
                <button
                  type="button"
                  className="shrink-0 rounded border border-brand/40 px-1.5 py-0.5 text-[10px] text-brand hover:bg-brand/10"
                  onClick={() => void restoreHistoryAction(it.id)}
                >
                  恢复
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const repairDockProps = {
    projectId,
    project,
    getAuthHeaders,
    transcriptionStatus: project.transcription_status,
    onRefreshProject: load,
    onProjectUpdated: setProject,
    onError: (msg: string) => setErr(msg)
  };

  const exportQualityControl = (
    <ClipExportQualitySelect
      projectId={projectId}
      exportOptions={project.export_options}
      getAuthHeaders={getAuthHeaders}
      disabled={!loggedIn || exportActive || actionBusy}
      onUpdated={(opts) => setProject((prev) => (prev ? { ...prev, export_options: opts } : prev))}
      onError={(msg) => setErr(msg)}
    />
  );

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      {loginPromptNode}
      <SmallConfirmModal
        open={transcribeConfirmOpen}
        title={t("clip.editor.transcribeConfirmTitle")}
        message={t("clip.editor.transcribeConfirmBody")}
        confirmLabel={t("clip.editor.transcribeShort")}
        cancelLabel={t("presto.flow.exportGate.cancel")}
        onCancel={() => setTranscribeConfirmOpen(false)}
        onConfirm={() => {
          setTranscribeConfirmOpen(false);
          void startTranscribe();
        }}
      />
      <WorkspaceScrimModal
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
        labelledBy="shortcut-help-title"
        scrimTone="35"
      >
        <div className="fym-modal-card w-full max-w-lg p-5" onPointerDown={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 id="shortcut-help-title" className="text-sm font-semibold text-ink">
                    快捷键与交互说明
                  </h3>
                  <button
                    type="button"
                    className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-fill"
                    onClick={() => setShortcutHelpOpen(false)}
                  >
                    关闭
                  </button>
                </div>
                <ul className="max-h-[min(70vh,24rem)] space-y-1 overflow-y-auto text-[12px] text-ink">
                  <li>`Space` 播放/暂停</li>
                  <li>`鼠标左键拖拽` 可直接框选词（无需先单击一个词）</li>
                  <li>`Shift + 点击 / Shift + ←/→` 连续扩选，`Ctrl/Cmd + 点击` 增量多选</li>
                  <li>`Delete/Backspace` 删除当前选区（或聚焦事件设为 Cut）</li>
                  <li>`Esc` 取消当前选区</li>
                  <li>`Ctrl/Cmd + A` 全选词块</li>
                  <li>`Ctrl/Cmd + ←/→` 按词移动焦点，`Home/End` 到稿首/稿尾</li>
                  <li>`Ctrl/Cmd + Z` 撤销，`Shift + Ctrl/Cmd + Z` 重做</li>
                  <li>`K / U / D` 事件卡片设为 Keep / Duck / Cut</li>
                  <li>`Ctrl/Cmd + F` 打开搜索，`Ctrl/Cmd + S` 立即保存删词</li>
                  <li>`?` 打开/关闭本面板</li>
                </ul>
              </div>
      </WorkspaceScrimModal>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {usePrdLayout ? (
              <ClipEditorPrdTopBar
                title={
                  projectTitleEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={projectTitleDraft}
                      onChange={(e) => setProjectTitleDraft(e.target.value)}
                      disabled={projectTitleBusy}
                      maxLength={200}
                      className="min-w-[16rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
                      onBlur={() => {
                        if (!projectTitleBusy) setProjectTitleEditing(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveProjectTitle();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setProjectTitleEditing(false);
                        }
                      }}
                    />
                  ) : (
                    <h1
                      className="min-w-0 truncate text-sm font-semibold text-ink sm:text-base"
                      onDoubleClick={() => {
                        setProjectTitleDraft(project.title || projectId);
                        setProjectTitleEditing(true);
                      }}
                      title="双击重命名"
                    >
                      {project.title || projectId}
                    </h1>
                  )
                }
                exportDisabled={exportButtonDisabled}
                exportLabel={exportButtonLabel}
                onExport={handleExportClick}
                beforeExport={exportQualityControl}
              />
            ) : (
              <PrestoFlowHeader
                backHref={WORKBENCH_PODCAST_CLIP_PATH}
                backLabel={t("clip.backToList")}
                title={project.title || projectId}
                titleOverride={
                  projectTitleEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={projectTitleDraft}
                      onChange={(e) => setProjectTitleDraft(e.target.value)}
                      disabled={projectTitleBusy}
                      maxLength={200}
                      className="min-w-[16rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
                      onBlur={() => {
                        if (!projectTitleBusy) setProjectTitleEditing(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveProjectTitle();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setProjectTitleEditing(false);
                        }
                      }}
                    />
                  ) : (
                    <h1
                      className="min-w-0 truncate text-sm font-semibold text-ink sm:text-base"
                      onDoubleClick={() => {
                        setProjectTitleDraft(project.title || projectId);
                        setProjectTitleEditing(true);
                      }}
                      title="双击重命名"
                    >
                      {project.title || projectId}
                    </h1>
                  )
                }
                engineLabel={engineLabel}
                engineState={engineState}
                beforeTranscribe={
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {clipToolsOpen ? (
                        <WaveformSegmentEditor
                          compact
                          zoomLevel={waveZoomLevel}
                          onZoomChange={(next) => {
                            setWaveZoomLevel(next);
                            waveformRef.current?.setZoom(next);
                          }}
                          onSplit={() => splitAtCursor("split")}
                          onSplitLeft={() => splitAtCursor("left")}
                          onSplitRight={() => splitAtCursor("right")}
                          onUndo={undoSegmentEdit}
                          undoDisabled={segmentUndoStackRef.current.length === 0}
                          disabled={segmentEditLocked}
                        />
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-soft hover:bg-fill"
                          onClick={() => setClipToolsOpen((v) => !v)}
                        >
                          <Scissors className="h-3.5 w-3.5" aria-hidden />
                          <span>音频剪辑</span>
                          <span className="text-muted">{clipToolsOpen ? "收起" : "展开"}</span>
                        </button>
                      </div>
                      <PrestoFlowImportBar
                        variant="inline"
                        projectId={projectId}
                        getAuthHeaders={getAuthHeaders}
                        disabled={!loggedIn || actionBusy || transcriptionActive || exportActive || audioMergeBusy}
                        label={t("presto.flow.importAudio")}
                        busyLabel={t("presto.flow.importBusy")}
                        hint={t("presto.flow.importHint")}
                        onDone={() => void load()}
                        onProjectPatch={setProject}
                        onError={(msg) => setErr(msg)}
                        allowMultiSegment={
                          project.transcription_status !== "succeeded" &&
                          project.transcription_status !== "running" &&
                          project.transcription_status !== "queued"
                        }
                      />
                    </div>
                  </div>
                }
                transcribeLabel={t("clip.editor.transcribeShort")}
                transcribeDisabled={
                  actionBusy ||
                  insertingSegmentAudio ||
                  audioMergeBusy ||
                  !hasServerAudio ||
                  project.transcription_status === "running" ||
                  project.transcription_status === "queued" ||
                  (project.transcription_status === "succeeded" && pendingInsertedSegments.length === 0)
                }
                exportDisabled={exportButtonDisabled}
                exportLabel={exportButtonLabel}
                onTranscribe={() => setTranscribeConfirmOpen(true)}
                onExport={handleExportClick}
                beforeExport={exportQualityControl}
              />
            )}
            {!usePrdLayout && dualInterview ? (
              <p className="border-b border-line bg-fill/30 px-4 py-1.5 text-[11px] text-muted">{t("presto.flow.interviewDual")}</p>
            ) : null}
            {err ? (
              <p className="px-4 py-2 text-sm text-danger-ink" role="alert">
                {err}
              </p>
            ) : null}
            {waveformErr ? (
              <p className="px-4 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
                音频预览：{waveformErr}
              </p>
            ) : null}
            {project.transcription_error ? (
              <p className="px-4 py-2 text-sm text-danger-ink" role="alert">
                转写失败：{project.transcription_error}
              </p>
            ) : null}
            {project.export_error ? <p className="px-4 text-sm text-danger-ink">{project.export_error}</p> : null}
            {exportActive ? (
              <p className="border-b border-line bg-brand/5 px-4 py-2 text-sm text-ink" role="status">
                {project.export_status === "queued"
                  ? t("clip.editor.exportStatus.queued")
                  : t("clip.editor.exportStatus.running")}
              </p>
            ) : null}
            {project.export_status === "succeeded" ? (
              <p className="border-b border-line bg-success-soft px-4 py-2 text-sm text-ink" role="status">
                {t("clip.editor.exportReadyBanner")}
                <button type="button" className="ml-2 font-medium underline" onClick={() => void downloadExportFile()}>
                  {t("clip.editor.downloadExport")}
                </button>
                <button
                  type="button"
                  className="ml-3 text-muted underline"
                  disabled={actionBusy || exportActive}
                  onClick={() => void performExport()}
                >
                  {t("clip.editor.exportAgain")}
                </button>
              </p>
            ) : null}
            {audioMergeBusy ? (
              <p className="border-b border-line bg-fill/30 px-4 py-1.5 text-[11px] text-muted">
                {project.audio_merge_status === "queued"
                  ? t("clip.editor.audioMergeQueued")
                  : t("clip.editor.audioMergeRunning")}
              </p>
            ) : null}
            {project.audio_merge_status === "failed" && project.audio_merge_error ? (
              <p className="px-4 text-sm text-danger-ink">{project.audio_merge_error}</p>
            ) : null}

            {showTranscriptFullscreen ? (
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {selectionToolbar.visible ? (
                  <div
                    ref={selectionToolbarRef}
                    className="pointer-events-auto fixed z-[12000] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-1.5 py-1 shadow-soft"
                    style={{ left: selectionToolbar.x, top: selectionToolbar.y }}
                  >
                    <div className="flex items-center gap-1 text-[10px]">
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => deleteSelectionFromToolbar()}>
                        删除
                      </button>
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => restoreSelectionFromExcluded()}>
                        恢复
                      </button>
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => setMultiSelectIds(new Set())}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
                <section
                  aria-label={t("presto.flow.region.script")}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface/20"
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-2 pt-2">
                    <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
                      <div className="flex-1 text-right">
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
                        ) : null}
                        <div className="mb-1 flex flex-wrap items-center justify-end gap-1 text-[10px]">
                          <span className="text-muted">说话人</span>
                          {[...new Set(lines.map((l) => l.speaker))].map((spk) => {
                            const active = speakerFocusSet.size === 0 || speakerFocusSet.has(spk);
                            const label = speakerNames[spk] || (spk === 0 ? t("presto.flow.speakerHost") : spk === 1 ? t("presto.flow.speakerGuest") : `S${spk + 1}`);
                            return (
                              <button
                                key={`spk-a-${spk}`}
                                type="button"
                                className={[
                                  "rounded border px-1.5 py-0.5",
                                  active ? "border-brand/50 text-brand" : "border-line text-muted hover:bg-fill"
                                ].join(" ")}
                                onClick={() =>
                                  setSpeakerFocusSet((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(spk)) next.delete(spk);
                                    else next.add(spk);
                                    return next;
                                  })
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                          {speakerFocusSet.size > 0 ? (
                            <>
                              <button
                                type="button"
                                className={[
                                  "rounded border px-1.5 py-0.5",
                                  onlySelectedSpeakers ? "border-brand/50 text-brand" : "border-line text-muted hover:bg-fill"
                                ].join(" ")}
                                onClick={() => setOnlySelectedSpeakers((v) => !v)}
                              >
                                只看已选说话人
                              </button>
                              <button
                                type="button"
                                className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-fill"
                                onClick={() => markManyExcluded(focusedSpeakerWordIds)}
                              >
                                仅删当前说话人
                              </button>
                              <button
                                type="button"
                                className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-fill"
                                onClick={() => markManyRestored(focusedSpeakerExcludedIds)}
                              >
                                仅恢复当前说话人
                              </button>
                            </>
                          ) : null}
                        </div>
                        {deleteFeedback ? (
                          <p className="shrink-0 text-[10px] font-semibold text-brand">{deleteFeedback}</p>
                        ) : null}
                        {actionHint ? <p className="shrink-0 text-[10px] font-semibold text-emerald-600">{actionHint}</p> : null}
                      </div>
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-fill hover:text-ink"
                        aria-label="快捷键与交互说明"
                        title="快捷键与交互说明"
                        onClick={() => setShortcutHelpOpen(true)}
                      >
                        <CircleHelp className="h-4 w-4" aria-hidden />
                      </button>
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
                    <div className="min-h-0 min-w-0 h-0 flex-1 overflow-hidden">
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
                        speakerNames={speakerNames}
                        onRenameSpeaker={renameSpeaker}
                        emptyLabel={
                          hasServerAudio ? t("presto.flow.transcriptEmpty") : t("presto.flow.editorNoAudioHint")
                        }
                        stutterDupHint={t("presto.flow.stutterDupHint")}
                        stutterGroupHint={t("presto.flow.stutterGroupHint")}
                        markersByWordId={transcriptMarkers}
                        roughCutHighlightIds={roughCutHighlightIds}
                        dismissedRoughKeys={dismissedRoughKeys}
                        silenceCards={transcriptSilenceCards}
                        onToggleSilenceCut={(s, e) => void toggleSilenceCut(s, e)}
                        onSetSilenceCapMs={(s, e, cap) => void setSilenceCapMs(s, e, cap)}
                        onJumpToSilence={(seg) => {
                          if (seg.jumpWordId) jumpToWordInTranscript(seg.jumpWordId);
                          else seekPreviewMs(seg.end + 1);
                        }}
                        audioEventCards={transcriptAudioEventCards}
                        onSetAudioEventAction={(id, action) => void setAudioEventAction(id, action)}
                        speakerFilterSet={transcriptSpeakerFilterSet}
                      />
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div
                className={
                  usePrdLayout
                    ? "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
                    : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-0 pb-0 pt-0 lg:flex-row lg:items-stretch"
                }
              >
                {selectionToolbar.visible ? (
                  <div
                    ref={selectionToolbarRef}
                    className="pointer-events-auto fixed z-[12000] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-1.5 py-1 shadow-soft"
                    style={{ left: selectionToolbar.x, top: selectionToolbar.y }}
                  >
                    <div className="flex items-center gap-1 text-[10px]">
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => deleteSelectionFromToolbar()}>
                        删除
                      </button>
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => restoreSelectionFromExcluded()}>
                        恢复
                      </button>
                      <button type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-fill" onClick={() => setMultiSelectIds(new Set())}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
                {usePrdLayout ? (
                  <ClipEditorPrdLeftRail
                    projectId={projectId}
                    project={project}
                    getAuthHeaders={getAuthHeaders}
                    audioStagingEntries={audioStagingEntries}
                    load={load}
                    onProjectPatch={setProject}
                    setErr={setErr}
                    hasServerAudio={hasServerAudio}
                    loggedIn={loggedIn}
                    actionBusy={actionBusy}
                    transcriptionActive={transcriptionActive}
                    exportActive={exportActive}
                    audioMergeBusy={audioMergeBusy}
                    pendingInsertedSegments={pendingInsertedSegments.length}
                    transcribeDisabled={
                      actionBusy ||
                      insertingSegmentAudio ||
                      audioMergeBusy ||
                      !hasServerAudio ||
                      project.transcription_status === "running" ||
                      project.transcription_status === "queued" ||
                      (project.transcription_status === "succeeded" && pendingInsertedSegments.length === 0)
                    }
                    transcribeLabel={t("clip.editor.transcribeShort")}
                    onTranscribe={() => setTranscribeConfirmOpen(true)}
                    allowMultiSegmentImport={
                      project.transcription_status !== "succeeded" &&
                      project.transcription_status !== "running" &&
                      project.transcription_status !== "queued"
                    }
                    approxSegmentDurationMs={approxSegmentDurationMs}
                    mainAudioDurationMs={durationMs ?? null}
                    stagingTranscribeSelectedKeys={stagingTranscribeSelectedKeys}
                    onStagingTranscribeSelectedKeysChange={setStagingTranscribeSelectedKeys}
                    segmentDurationMsByKey={segmentDurationMsByKey}
                    transcriptionSucceeded={project.transcription_status === "succeeded"}
                  />
                ) : null}
                <div
                  className={
                    usePrdLayout
                      ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                      : "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:min-w-0 lg:flex-[1.28]"
                  }
                >
                  <section
                    aria-label={t("presto.flow.region.script")}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-line bg-surface/20"
                  >
                    {usePrdLayout ? (
                      <ClipEditorPrdScriptToolbar
                        scriptSearch={scriptSearch}
                        onScriptSearch={setScriptSearch}
                        scriptSearchInputRef={scriptSearchInputRef}
                        words={words}
                        lines={lines}
                        excluded={excluded}
                        onNavigateSearchHit={navigateScriptSearchHit}
                        activeSearchHighlightWordId={activeSearchHighlightWordId}
                        onSelectAllSearchHits={selectAllScriptSearchHits}
                        searchAllHitsSelected={searchAllHitsSelected}
                        allSearchHitsHighlighted={allSearchHitsHighlighted}
                        onDeleteAllSearchHits={deleteAllScriptSearchHits}
                        verbalSheetProps={{ ...roughCutDockProps }}
                        pauseSheetProps={{ ...roughCutDockProps }}
                        historyPanel={prdHistoryPanel}
                        onRepairAmbient={() => void runClipPrdRepair("ambient")}
                        onRepairVoiceClarity={() => void runClipPrdRepair("voice_clarity")}
                        onRepairLoudnorm={() => void runClipPrdRepair("loudnorm")}
                        repairBusyKind={prdRepairBusyKind}
                      />
                    ) : null}
                    {usePrdLayout && showTranscriptAudioTransport ? (
                      <div className="sr-only" aria-hidden>
                        {useTranscriptVirtualPlayback ? (
                          <ClipVirtualAudioTransport
                            key={`v:${virtualAudioCues.map((c) => c.objectKey).join("|")}`}
                            ref={waveformRef}
                            cues={virtualAudioCues}
                            onTimeMs={handlePlaybackTimeMs}
                            onLoadError={handleWaveformLoadError}
                            onPlayStateChange={handleWaveformPlayState}
                            playbackRate={playbackRate}
                            snapSeekMs={snapSeekMs}
                          />
                        ) : (
                          <ClipAudioTransport
                            ref={waveformRef}
                            audioUrl={transcriptPlayerAudioUrl}
                            onTimeMs={handlePlaybackTimeMs}
                            onLoadError={handleWaveformLoadError}
                            onPlayStateChange={handleWaveformPlayState}
                            playbackRate={playbackRate}
                          />
                        )}
                      </div>
                    ) : null}
                    {!usePrdLayout ? (
                    <div className="shrink-0 border-b border-line bg-fill/15 px-2 py-2">
                      {!usePrdLayout ? (
                        <ClipStagingTracksBar
                          projectId={projectId}
                          entries={audioStagingEntries}
                          getAuthHeaders={getAuthHeaders}
                          disabled={actionBusy || transcriptionActive || exportActive || audioMergeBusy}
                          onRefresh={() => void load()}
                          onProjectPatch={setProject}
                          onError={(msg) => setErr(msg)}
                          selectedTranscribeKeys={stagingTranscribeSelectedKeys}
                          onSelectedTranscribeKeysChange={setStagingTranscribeSelectedKeys}
                          approxDurationMsPerSegment={approxSegmentDurationMs}
                          durationMsBySegmentKey={segmentDurationMsByKey}
                          transcriptionSucceeded={project.transcription_status === "succeeded"}
                        />
                      ) : null}
                      {wordchainPreviewBusy ? (
                        <div
                          className="mb-2 rounded-lg border border-brand/25 bg-brand/10 px-2.5 py-1.5 text-[10px] text-ink"
                          role="status"
                        >
                          {t("presto.flow.editedPreviewUpdating")}
                        </div>
                      ) : null}
                      {showTranscriptAudioTransport ? (
                        <div className="sr-only" aria-hidden>
                          {useTranscriptVirtualPlayback ? (
                            <ClipVirtualAudioTransport
                              key={`v:${virtualAudioCues.map((c) => c.objectKey).join("|")}`}
                              ref={waveformRef}
                              cues={virtualAudioCues}
                              onTimeMs={handlePlaybackTimeMs}
                              onLoadError={handleWaveformLoadError}
                              onPlayStateChange={handleWaveformPlayState}
                              playbackRate={playbackRate}
                              snapSeekMs={snapSeekMs}
                            />
                          ) : (
                            <ClipAudioTransport
                              ref={waveformRef}
                              audioUrl={transcriptPlayerAudioUrl}
                              onTimeMs={handlePlaybackTimeMs}
                              onLoadError={handleWaveformLoadError}
                              onPlayStateChange={handleWaveformPlayState}
                              playbackRate={playbackRate}
                            />
                          )}
                        </div>
                      ) : null}
                      <input
                        ref={insertAudioInputRef}
                        type="file"
                        className="sr-only"
                        accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          const ix = insertBoundaryIndexRef.current;
                          if (!f || ix == null) return;
                          void uploadInsertedAudioAtBoundary(f, ix).catch((error) => {
                            setErr(String(error instanceof Error ? error.message : error));
                          });
                          e.currentTarget.value = "";
                        }}
                      />
                    </div>
                    ) : null}
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-2 pt-2">
                      <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
                        <div className="flex-1 text-right">
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
                          ) : null}
                          {!usePrdLayout ? (
                            <div className="mb-1 flex flex-wrap items-center justify-end gap-1 text-[10px]">
                              <span className="text-muted">说话人</span>
                              {[...new Set(lines.map((l) => l.speaker))].map((spk) => {
                                const active = speakerFocusSet.size === 0 || speakerFocusSet.has(spk);
                                const label =
                                  speakerNames[spk] ||
                                  (spk === 0 ? t("presto.flow.speakerHost") : spk === 1 ? t("presto.flow.speakerGuest") : `S${spk + 1}`);
                                return (
                                  <button
                                    key={`spk-b-${spk}`}
                                    type="button"
                                    className={[
                                      "rounded border px-1.5 py-0.5",
                                      active ? "border-brand/50 text-brand" : "border-line text-muted hover:bg-fill"
                                    ].join(" ")}
                                    onClick={() =>
                                      setSpeakerFocusSet((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(spk)) next.delete(spk);
                                        else next.add(spk);
                                        return next;
                                      })
                                    }
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                              {speakerFocusSet.size > 0 ? (
                                <>
                                  <button
                                    type="button"
                                    className={[
                                      "rounded border px-1.5 py-0.5",
                                      onlySelectedSpeakers ? "border-brand/50 text-brand" : "border-line text-muted hover:bg-fill"
                                    ].join(" ")}
                                    onClick={() => setOnlySelectedSpeakers((v) => !v)}
                                  >
                                    只看已选说话人
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-fill"
                                    onClick={() => markManyExcluded(focusedSpeakerWordIds)}
                                  >
                                    仅删当前说话人
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-fill"
                                    onClick={() => markManyRestored(focusedSpeakerExcludedIds)}
                                  >
                                    仅恢复当前说话人
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          {deleteFeedback ? (
                            <p className="shrink-0 text-[10px] font-semibold text-brand">{deleteFeedback}</p>
                          ) : null}
                          {actionHint ? <p className="shrink-0 text-[10px] font-semibold text-emerald-600">{actionHint}</p> : null}
                        </div>
                        {!usePrdLayout ? (
                          <>
                            <button
                              type="button"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-fill hover:text-ink"
                              aria-label="快捷键与交互说明"
                              title="快捷键与交互说明"
                              onClick={() => setShortcutHelpOpen(true)}
                            >
                              <CircleHelp className="h-4 w-4" aria-hidden />
                            </button>
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
                          </>
                        ) : null}
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
                      <div className="min-h-0 min-w-0 h-0 flex-1 overflow-hidden">
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
                          speakerNames={speakerNames}
                          onRenameSpeaker={renameSpeaker}
                          emptyLabel={
                            hasServerAudio ? t("presto.flow.transcriptEmpty") : t("presto.flow.editorNoAudioHint")
                          }
                          stutterDupHint={t("presto.flow.stutterDupHint")}
                          stutterGroupHint={t("presto.flow.stutterGroupHint")}
                          markersByWordId={transcriptMarkers}
                          roughCutHighlightIds={roughCutHighlightIds}
                          dismissedRoughKeys={dismissedRoughKeys}
                          silenceCards={transcriptSilenceCards}
                          onToggleSilenceCut={(s, e) => void toggleSilenceCut(s, e)}
                          onSetSilenceCapMs={(s, e, cap) => void setSilenceCapMs(s, e, cap)}
                          onJumpToSilence={(seg) => {
                            if (seg.jumpWordId) jumpToWordInTranscript(seg.jumpWordId);
                            else seekPreviewMs(seg.end + 1);
                          }}
                          audioEventCards={transcriptAudioEventCards}
                          onSetAudioEventAction={(id, action) => void setAudioEventAction(id, action)}
                          speakerFilterSet={transcriptSpeakerFilterSet}
                        />
                      </div>
                    </div>
                    {usePrdLayout ? (
                      <AudioConsole
                        waveformRef={waveformRef}
                        playing={waveformPlaying}
                        keyboardHint={t("presto.flow.audioConsoleSpaceHint")}
                        playbackRate={playbackRate}
                        onPlaybackRateChange={setPlaybackRate}
                        rateOptionLabels={[
                          t("presto.flow.playbackRate1"),
                          t("presto.flow.playbackRate125"),
                          t("presto.flow.playbackRate150"),
                          t("presto.flow.playbackRate200")
                        ]}
                        rateSelectAriaLabel={t("presto.flow.playbackRateAria")}
                        durationMs={audioConsoleScrubDurationMs}
                        currentTimeMs={playbackMs}
                        materialTimeline={audioConsoleMaterialTimeline}
                        onSeekMs={(ms) => {
                          waveformRef.current?.seekToMs(resolveWaveformSeekMs(ms));
                        }}
                        onPlayPause={() => void handleTranscriptPlayPause()}
                      />
                    ) : null}
                    {usePrdLayout && wordchainPreviewBusy ? (
                      <p className="shrink-0 border-t border-line/60 px-3 py-1.5 text-[10px] text-muted" role="status">
                        {t("presto.flow.editedPreviewUpdating")}
                      </p>
                    ) : null}
                  </section>
                </div>
                {!usePrdLayout ? (
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
                        ["history", History, "变更历史"] as const,
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
                      disabled={project.export_status !== "succeeded"}
                      onClick={() => void downloadExportFile()}
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
                        {workbenchTab === "suggestions" ? <ClipRoughCutPanel {...roughCutDockProps} /> : null}
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
                        {workbenchTab === "history" ? (
                          <section className="p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:bg-fill disabled:opacity-40"
                                disabled={editUndoStackRef.current.length === 0}
                                onClick={() => undoExcluded()}
                              >
                                撤销
                              </button>
                              <button
                                type="button"
                                className="rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:bg-fill disabled:opacity-40"
                                disabled={editRedoStackRef.current.length === 0}
                                onClick={() => redoExcluded()}
                              >
                                重做
                              </button>
                            </div>
                            {historyActions.length === 0 ? (
                              <p className="text-[11px] text-muted">暂无变更历史</p>
                            ) : (
                              <ul className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
                                {historyActions.map((it) => (
                                  <li
                                    key={it.id}
                                    className={[
                                      "rounded-lg border px-2 py-1.5 text-[10px] transition",
                                      selectedHistoryId === it.id
                                        ? "border-brand/50 bg-brand/5"
                                        : "border-line/80 bg-surface/70 hover:bg-fill/40"
                                    ].join(" ")}
                                  >
                                    <div className="mb-1 flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        onClick={() => setSelectedHistoryId((prev) => (prev === it.id ? null : it.id))}
                                      >
                                        <span className="shrink-0 font-mono text-muted">{formatHistoryTime(it.at)}</span>
                                        <span className="min-w-0 flex-1 truncate text-ink">{it.label}</span>
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={it.seekMs == null}
                                        className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-fill disabled:opacity-40"
                                        onClick={() => {
                                          if (it.seekMs == null) return;
                                          seekPreviewMs(it.seekMs);
                                        }}
                                      >
                                        回看定位
                                      </button>
                                      {selectedHistoryId === it.id ? (
                                        <button
                                          type="button"
                                          className="rounded border border-brand/40 px-1.5 py-0.5 text-brand hover:bg-brand/10"
                                          onClick={() => void restoreHistoryAction(it.id)}
                                        >
                                          恢复这一步
                                        </button>
                                      ) : null}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </aside>
                ) : null}
              </div>
            )}
          </div>
          {!usePrdLayout ? (
            <AudioConsole
              dockEmbed
              waveformRef={waveformRef}
              playing={waveformPlaying}
              keyboardHint={t("presto.flow.audioConsoleSpaceHint")}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackRate}
              rateOptionLabels={[
                t("presto.flow.playbackRate1"),
                t("presto.flow.playbackRate125"),
                t("presto.flow.playbackRate150"),
                t("presto.flow.playbackRate200")
              ]}
              rateSelectAriaLabel={t("presto.flow.playbackRateAria")}
              durationMs={audioConsoleScrubDurationMs}
              currentTimeMs={playbackMs}
              materialTimeline={audioConsoleMaterialTimeline}
              onSeekMs={(ms) => {
                waveformRef.current?.seekToMs(resolveWaveformSeekMs(ms));
              }}
              onPlayPause={() => void handleTranscriptPlayPause()}
            />
          ) : null}
        </div>
      </div>
  );
}
