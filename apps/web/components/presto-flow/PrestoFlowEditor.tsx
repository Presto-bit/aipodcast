"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { ClipProjectRow, ClipSilenceSegment, ClipTimelineClip, ClipTimelineDoc, ClipWord } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import { adjustPlaybackMsForExcluded, findActiveWordIndex } from "../../lib/prestoFlowPlayback";
import {
  buildClipEditSuggestions,
  buildSilenceWordSuggestions,
  mapLlmApiItemsToSuggestions,
  type ClipEditSuggestion,
  type ClipOutlineSource,
  type LlmSuggestionApiItem
} from "../../lib/prestoFlowAiSuggestions";
import type { TranscriptWordSuggestionMarker } from "../../lib/prestoFlowTranscriptMarkers";
import { buildSpeechTimelineFromWords } from "../../lib/prestoFlowTimelineDerive";
import { buildFlowUnits, groupSpeakerSentenceLines } from "../../lib/prestoFlowTranscript";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import type { ClipWaveformHandle } from "../clip/ClipWaveformPanel";
import AudioConsole from "./AudioConsole";
import ClipAiSuggestionsPanel from "./ClipAiSuggestionsPanel";
import ClipExportQcGateModal from "./ClipExportQcGateModal";
import ClipQcWorkbenchPanel from "./ClipQcWorkbenchPanel";
import ClipTimelineStrip from "./ClipTimelineStrip";
import MicroWavePopover from "./MicroWavePopover";
import PrestoFlowHeader from "./PrestoFlowHeader";
import PrestoFlowImportBar from "./PrestoFlowImportBar";
import PrestoFlowSideNav, { type PrestoNavSection } from "./PrestoFlowSideNav";
import ClipProductionStudio from "./ClipProductionStudio";
import VirtualizedTranscript, { type VirtualizedTranscriptHandle } from "./VirtualizedTranscript";

function isDualChannels(ch: unknown): boolean {
  return Array.isArray(ch) && ch.length >= 2;
}

function clipJobLabel(t: (key: string) => string, prefix: "transcription" | "export", status: string | undefined): string {
  const st = status || "idle";
  const key = `clip.editor.${prefix}Status.${st}`;
  const label = t(key);
  return label === key ? st : label;
}

type EngineHeaderState = "idle" | "queued" | "running" | "ready" | "failed";

function mapTranscriptionToEngine(st: string | undefined): EngineHeaderState {
  if (st === "queued" || st === "running") return st === "queued" ? "queued" : "running";
  if (st === "succeeded") return "ready";
  if (st === "failed") return "failed";
  return "idle";
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
  const router = useRouter();
  const { getAuthHeaders } = useAuth();

  const [project, setProject] = useState<ClipProjectRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [focusedWordId, setFocusedWordId] = useState<string | null>(null);
  const [micro, setMicro] = useState<{ word: ClipWord; rect: DOMRect } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [saveExcludedHint, setSaveExcludedHint] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [nav, setNav] = useState<PrestoNavSection>("storyboard");
  const [searchQ, setSearchQ] = useState("");
  const [llmSugs, setLlmSugs] = useState<ClipEditSuggestion[]>([]);
  /** idle | outline | structured | expand */
  const [llmPhase, setLlmPhase] = useState<"idle" | "outline" | "structured" | "expand">("idle");
  const [silenceSegments, setSilenceSegments] = useState<ClipSilenceSegment[] | null>(null);
  /** 稿面词级标记：suggestionKey 对应 ClipEditSuggestion.id */
  const [wordMarkers, setWordMarkers] = useState<Record<string, { suggestionKey: string; status: "pending" | "applied" }>>(
    {}
  );
  /** 右侧工作台：默认展开（建议 / 工程 / 质检） */
  const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
  const [workbenchTab, setWorkbenchTab] = useState<"suggestions" | "engine" | "qc">("suggestions");
  const [timelineStripCollapsed, setTimelineStripCollapsed] = useState(false);
  const [exportGateOpen, setExportGateOpen] = useState(false);
  const [exportGatePhase, setExportGatePhase] = useState<"idle" | "analyze" | "export">("idle");
  const [exportGateErr, setExportGateErr] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformRef = useRef<ClipWaveformHandle | null>(null);
  const transcriptRef = useRef<VirtualizedTranscriptHandle | null>(null);
  /** 剪辑点前后 5s 试听窗口：此区间内不按 excluded 跳过，便于听原片上下文 */
  const previewWindowRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const excludedRef = useRef(excluded);
  const excludedUndoStack = useRef<string[][]>([]);
  const excludedRedoStack = useRef<string[][]>([]);
  const [, bumpExcludedHistory] = useReducer((n: number) => n + 1, 0);
  const lastScrollWordId = useRef("");

  useEffect(() => {
    excludedRef.current = excluded;
  }, [excluded]);

  const words = useMemo(() => {
    const w = project?.transcript_normalized?.words;
    return Array.isArray(w) ? (w as ClipWord[]) : [];
  }, [project]);

  const wordsFiltered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) => `${w.text}${w.punct ?? ""}`.toLowerCase().includes(q));
  }, [words, searchQ]);

  const lines = useMemo(
    () => groupSpeakerSentenceLines(buildFlowUnits(wordsFiltered)),
    [wordsFiltered]
  );

  const speechTimeline = useMemo(() => buildSpeechTimelineFromWords(words, excluded), [words, excluded]);

  const durationMs = useMemo(() => {
    const d = project?.transcript_normalized?.duration_ms;
    if (typeof d === "number" && d > 0) return d;
    if (!words.length) return null;
    return Math.max(...words.map((w) => w.e_ms), 0);
  }, [project, words]);

  const editSuggestions = useMemo(() => buildClipEditSuggestions(words, excluded), [words, excluded]);
  const silenceSuggestions = useMemo(
    () => buildSilenceWordSuggestions(words, silenceSegments ?? undefined, excluded),
    [words, silenceSegments, excluded]
  );
  const displaySuggestions = useMemo(
    () => [...editSuggestions, ...silenceSuggestions, ...llmSugs],
    [editSuggestions, silenceSuggestions, llmSugs]
  );

  useEffect(() => {
    setLlmSugs([]);
    setWordMarkers({});
    setSilenceSegments(null);
    setLlmPhase("idle");
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

  const handlePlaybackTimeMs = useCallback(
    (ms: number) => {
      const pw = previewWindowRef.current;
      if (pw) {
        if (ms >= pw.endMs) {
          previewWindowRef.current = null;
          waveformRef.current?.pause();
          setPlaybackMs(pw.endMs);
          return;
        }
        if (ms < pw.startMs - 80) {
          waveformRef.current?.seekToMs(pw.startMs);
          setPlaybackMs(pw.startMs);
          return;
        }
        setPlaybackMs(ms);
        return;
      }
      const adj = adjustPlaybackMsForExcluded(words, excludedRef.current, ms, durationMs);
      if (adj !== ms) waveformRef.current?.seekToMs(adj);
      setPlaybackMs(adj);
    },
    [words, durationMs]
  );

  const hasServerAudio = Boolean(project?.has_audio) || Boolean(project?.audio_download_url);
  const waveformAudioUrl = hasServerAudio
    ? `/api/clip/projects/${encodeURIComponent(projectId)}/audio/file`
    : undefined;

  useEffect(() => {
    if (project?.transcription_status !== "succeeded" || !hasServerAudio) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/silences`, {
          credentials: "same-origin",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          segments?: ClipSilenceSegment[];
        };
        if (cancelled || !res.ok || data.success === false || !Array.isArray(data.segments)) return;
        setSilenceSegments(data.segments);
      } catch {
        if (!cancelled) setSilenceSegments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAuthHeaders, projectId, project?.transcription_status, hasServerAudio]);

  const transcriptionActive =
    project?.transcription_status === "running" || project?.transcription_status === "queued";
  const exportActive = project?.export_status === "running" || project?.export_status === "queued";
  const dualInterview = isDualChannels(project?.channel_ids);

  const activeWordIndex = useMemo(
    () => findActiveWordIndex(words, playbackMs),
    [words, playbackMs]
  );
  const playbackWordId = activeWordIndex >= 0 && words[activeWordIndex] ? words[activeWordIndex]!.id : null;

  useEffect(() => {
    if (!playbackWordId) {
      lastScrollWordId.current = "";
      return;
    }
    if (playbackWordId === lastScrollWordId.current) return;
    lastScrollWordId.current = playbackWordId;
    transcriptRef.current?.scrollToWordId(playbackWordId);
  }, [playbackWordId]);

  const startClipContextPreview = useCallback(() => {
    if (durationMs == null || durationMs <= 0) return;
    const wFocused = focusedWordId ? words.find((x) => x.id === focusedWordId) : undefined;
    const wPlay = activeWordIndex >= 0 ? words[activeWordIndex] : undefined;
    const w2 = wFocused ?? wPlay;
    if (!w2) return;
    const center = Math.round((w2.s_ms + w2.e_ms) / 2);
    const start = Math.max(0, center - 5000);
    const end = Math.min(durationMs, center + 5000);
    previewWindowRef.current = { startMs: start, endMs: end };
    waveformRef.current?.seekToMs(start);
    void waveformRef.current?.play();
  }, [focusedWordId, words, activeWordIndex, durationMs]);

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
      const id = window.setInterval(() => void load(), 2500);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [load, project?.transcription_status, project?.export_status]);

  const scheduleSaveExcluded = useCallback(
    (next: Set<string>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          setSaveExcludedHint("saving");
          try {
            const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
              method: "PATCH",
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
        })();
      }, 500);
    },
    [getAuthHeaders, projectId]
  );

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (micro) {
        if (e.key === "Escape") setMicro(null);
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const wid = el?.getAttribute("data-word-id") || el?.dataset?.wordId;
      if (wid && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        const w = words.find((x) => x.id === wid);
        if (w) {
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
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redoExcluded();
        else undoExcluded();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redoExcluded();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [micro, redoExcluded, undoExcluded, words, scheduleSaveExcluded]);

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

  const onSeekTimelineClip = useCallback(
    (clip: ClipTimelineClip) => {
      const wid = clip.word_ids?.[0];
      if (!wid) return;
      setFocusedWordId(wid);
      transcriptRef.current?.scrollToWordId(wid);
      const w = words.find((x) => x.id === wid);
      if (w) waveformRef.current?.seekToMs(w.s_ms);
    },
    [words]
  );

  const clearMarkersForSuggestion = useCallback((s: ClipEditSuggestion) => {
    const ex = s.execute;
    if (!ex || (ex.kind !== "excludeWords" && ex.kind !== "keepStutterFirst")) return;
    setWordMarkers((prev) => {
      const next = { ...prev };
      for (const id of ex.wordIds) delete next[id];
      return next;
    });
  }, []);

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

  const onRestoreStudioSnapshot = useCallback(
    async (excludedIds: string[], timeline?: ClipTimelineDoc | null) => {
      setErr("");
      excludedUndoStack.current.push([...excludedRef.current].sort());
      excludedRedoStack.current = [];
      setExcluded(new Set(excludedIds));
      bumpExcludedHistory();
      try {
        if (timeline && typeof timeline === "object" && Array.isArray(timeline.tracks)) {
          const tlr = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/timeline`, {
            method: "PUT",
            credentials: "same-origin",
            headers: { "content-type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ timeline })
          });
          const td = (await tlr.json().catch(() => ({}))) as { success?: boolean; detail?: string };
          if (!tlr.ok || td.success === false) {
            throw new Error(td.detail || `时间线恢复失败 ${tlr.status}`);
          }
        }
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ excluded_word_ids: excludedIds })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存排除词失败 ${res.status}`);
        }
        setSaveExcludedHint("saved");
        window.setTimeout(() => {
          setSaveExcludedHint((h) => (h === "saved" ? "idle" : h));
        }, 2200);
        await load();
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
      }
    },
    [getAuthHeaders, projectId, load]
  );

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `删除失败 ${res.status}`);
      }
      router.replace("/clip");
    } catch (e) {
      setDeleteErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const engineState = mapTranscriptionToEngine(project?.transcription_status);
  const engineLabel = `${t("presto.flow.engineCaption")}: ${clipJobLabel(t, "transcription", project?.transcription_status)}`;

  if (loading && !project) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas text-sm text-muted">
        {t("clip.loading")}
      </div>
    );
  }

  if (!project && !loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-4">
        <p className="text-sm text-danger-ink">{err || t("clip.editor.notFound")}</p>
        <Link href="/clip" className="text-sm text-brand hover:underline">
          {t("clip.backToList")}
        </Link>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink">
      <SmallConfirmModal
        open={deleteOpen}
        title={t("clip.editor.deleteConfirmTitle")}
        message={t("clip.editor.deleteConfirmMessage")}
        confirmLabel={t("clip.editor.deleteConfirm")}
        cancelLabel={t("clip.editor.deleteCancel")}
        danger
        busy={deleteBusy}
        busyLabel={t("clip.editor.deleting")}
        error={deleteErr}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteOpen(false);
          setDeleteErr(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      <MicroWavePopover
        word={micro?.word ?? null}
        anchor={micro?.rect ?? null}
        onClose={() => setMicro(null)}
        title={t("presto.flow.microTitle")}
        hint={t("presto.flow.microHint")}
      />

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

      <div className="flex min-h-0 flex-1">
        <PrestoFlowSideNav
          active={nav}
          onSelect={(s) => setNav(s)}
          onDownloadClick={() => {
            const u = project.export_download_url;
            if (u) window.open(u, "_blank", "noopener,noreferrer");
          }}
          hasExportUrl={Boolean(project.export_download_url)}
          labels={{
            storyboard: t("presto.flow.nav.storyboard"),
            music: t("presto.flow.nav.music"),
            download: t("clip.editor.downloadExport")
          }}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PrestoFlowHeader
              backHref="/clip"
              backLabel={t("clip.backToList")}
              title={project.title || projectId}
              engineLabel={engineLabel}
              engineState={engineState}
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
              trailing={
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-danger/40 bg-surface p-2 text-danger-ink shadow-soft hover:bg-danger-soft"
                  aria-label={t("clip.editor.deleteProject")}
                  onClick={() => {
                    setDeleteErr(null);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              }
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

            <div className="flex min-h-0 min-w-0 flex-1 flex-col px-0 pb-0 pt-0">
              <PrestoFlowImportBar
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
                  project.transcription_status === "succeeded" ? t("presto.flow.importDisabledTranscribed") : undefined
                }
                label={t("presto.flow.importAudio")}
                busyLabel={t("presto.flow.importBusy")}
                hint={t("presto.flow.importHint")}
                replaceWarn={t("presto.flow.importReplaceWarn")}
                onDone={() => void load()}
                onError={(msg) => setErr(msg)}
              />
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-2 lg:flex-row lg:items-stretch">
                <section className="flex min-h-0 min-w-0 flex-1 flex-col lg:min-h-[min(520px,55vh)]">
                  {nav === "storyboard" || nav === "music" ? (
                    <div className="mb-2 rounded-lg border border-dashed border-line bg-fill/40 px-3 py-2 text-center text-[11px] text-muted">
                      {t("presto.flow.placeholderNav")}
                    </div>
                  ) : null}
                  <div className="mb-2 flex gap-2">
                    <input
                      type="search"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder={t("presto.flow.searchPlaceholder")}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
                    />
                  </div>
                  <ClipTimelineStrip
                    timeline={speechTimeline}
                    durationMs={durationMs}
                    collapsed={timelineStripCollapsed}
                    onToggleCollapsed={() => setTimelineStripCollapsed((v) => !v)}
                    onSeekToClip={onSeekTimelineClip}
                    title={t("presto.flow.timelineStrip.title")}
                    intro={t("presto.flow.timelineStrip.intro")}
                    empty={t("presto.flow.timelineStrip.empty")}
                    clipsLabel={t("presto.flow.studio.timelineClipsLabel")}
                  />
                  {transcriptionActive && words.length === 0 ? (
                    <div className="mb-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                      {t("clip.editor.transcribingBody")}
                    </div>
                  ) : null}
                  {exportActive && project.transcription_status === "succeeded" ? (
                    <div className="mb-2 rounded-lg border border-line bg-fill px-3 py-2 text-xs text-muted" role="status">
                      {t("clip.editor.exportingBody")}
                    </div>
                  ) : null}
                  {saveExcludedHint !== "idle" ? (
                    <p className="mb-1 text-[10px] text-muted">
                      {saveExcludedHint === "saving"
                        ? t("clip.editor.saveExcludedSaving")
                        : saveExcludedHint === "saved"
                          ? t("clip.editor.saveExcludedSaved")
                          : t("clip.editor.saveExcludedFailed")}
                    </p>
                  ) : null}
                  <VirtualizedTranscript
                    ref={transcriptRef}
                    lines={lines}
                    excluded={excluded}
                    playbackWordId={playbackWordId}
                    focusedWordId={focusedWordId}
                    onFocusWordId={setFocusedWordId}
                    onToggleWord={toggleWord}
                    onLongPressWord={(w, rect) => setMicro({ word: w, rect })}
                    onKeepStutterFirst={onKeepStutterFirst}
                    ariaKeepLabel={t("clip.editor.wordAriaKeep")}
                    ariaCutLabel={t("clip.editor.wordAriaCut")}
                    keepFirstLabel={t("presto.flow.keepFirstOnly")}
                    expandLabel={t("presto.flow.expandStack")}
                    hostLabel={t("presto.flow.speakerHost")}
                    guestLabel={t("presto.flow.speakerGuest")}
                    emptyLabel={
                      hasServerAudio ? t("presto.flow.transcriptEmpty") : t("presto.flow.editorNoAudioHint")
                    }
                    markersByWordId={transcriptMarkers}
                  />
                </section>
                {!rightDrawerOpen ? (
                  <button
                    type="button"
                    className="absolute right-0 top-40 z-[15] flex h-24 w-7 items-center justify-center rounded-l-lg border border-line border-r-0 bg-surface/95 text-muted shadow-soft hover:bg-fill hover:text-ink"
                    aria-label={t("presto.flow.drawer.open")}
                    onClick={() => setRightDrawerOpen(true)}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
                <aside
                  className={[
                    "flex min-h-0 flex-col border-line bg-surface/60 transition-[width,min-width,opacity] duration-200 ease-out",
                    rightDrawerOpen
                      ? "ml-0 w-[min(22rem,92vw)] min-w-[min(18rem,85vw)] max-w-md border-l opacity-100 lg:min-w-[18rem] lg:max-w-sm"
                      : "pointer-events-none w-0 min-w-0 overflow-hidden border-l-0 opacity-0"
                  ].join(" ")}
                >
                  {rightDrawerOpen ? (
                    <>
                      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-line px-1.5 py-1">
                        <div className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                          {(
                            [
                              ["suggestions", t("presto.flow.drawer.tabSuggestions")] as const,
                              ["engine", t("presto.flow.drawer.tabEngine")] as const,
                              ["qc", t("presto.flow.drawer.tabQc")] as const
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setWorkbenchTab(id)}
                              className={[
                                "rounded-md px-2 py-1 text-[10px] font-semibold transition",
                                workbenchTab === id ? "bg-brand/18 text-brand" : "text-muted hover:bg-fill hover:text-ink"
                              ].join(" ")}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="rounded p-1 text-muted hover:bg-fill hover:text-ink"
                          aria-label={t("presto.flow.drawer.collapse")}
                          onClick={() => setRightDrawerOpen(false)}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto">
                        {workbenchTab === "suggestions" ? (
                          <ClipAiSuggestionsPanel
                            embedded
                            title={t("presto.flow.aiSuggestionsTitle")}
                            empty={t("presto.flow.aiSuggestionsEmpty")}
                            suggestions={displaySuggestions}
                            jumpLabel={t("presto.flow.aiSuggestionJump")}
                            deepseekTitle={t("presto.flow.aiDeepseekHint")}
                            deepseekOutlineLabel={t("presto.flow.aiDeepseekOutline")}
                            deepseekOutlineBusy={llmPhase === "outline"}
                            onLoadDeepseekOutline={
                              project.transcription_status === "succeeded"
                                ? () => void loadDeepseekOutline()
                                : undefined
                            }
                            deepseekStructuredLabel={t("presto.flow.aiDeepseekStructured")}
                            deepseekStructuredBusy={llmPhase === "structured"}
                            onLoadDeepseekStructured={
                              project.transcription_status === "succeeded"
                                ? () => void loadDeepseekStructured()
                                : undefined
                            }
                            expandOutlineLabel={t("presto.flow.aiExpandOutline")}
                            outlineExpandBusy={llmPhase === "expand"}
                            onExpandOutline={(src) => void loadDeepseekExpandOutline(src)}
                            onJumpWord={(wid) => {
                              setFocusedWordId(wid);
                              transcriptRef.current?.scrollToWordId(wid);
                              const w = words.find((x) => x.id === wid);
                              if (w) waveformRef.current?.seekToMs(w.s_ms);
                            }}
                            onExecute={onExecuteSuggestion}
                          />
                        ) : null}
                        {workbenchTab === "engine" ? (
                          <ClipProductionStudio
                            embedded
                            tabScope="engineering"
                            projectId={projectId}
                            transcriptionStatus={project.transcription_status}
                            getAuthHeaders={getAuthHeaders}
                            excludedWordIds={[...excluded]}
                            focusedWordId={focusedWordId}
                            onRestoreEditState={(ids, tl) => void onRestoreStudioSnapshot(ids, tl ?? undefined)}
                            onRefreshProject={load}
                            onError={(msg) => setErr(msg)}
                          />
                        ) : null}
                        {workbenchTab === "qc" ? (
                          <ClipQcWorkbenchPanel
                            projectId={projectId}
                            getAuthHeaders={getAuthHeaders}
                            qcReport={project.qc_report}
                            onRefreshProject={load}
                            onError={(msg) => setErr(msg)}
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </aside>
              </div>
            </div>
          </div>

          <AudioConsole
            audioUrl={waveformAudioUrl}
            onTimeMs={handlePlaybackTimeMs}
            onLoadError={(msg) => setErr((p) => (p ? `${p}\n${msg}` : msg))}
            waveformRef={waveformRef}
            clipPreviewAroundLabel={t("presto.flow.clipPreviewAround")}
            onClipPreviewAround={() => startClipContextPreview()}
            clipPreviewAroundDisabled={
              !hasServerAudio ||
              !words.length ||
              durationMs == null ||
              (!focusedWordId && playbackWordId == null)
            }
          />
        </div>
      </div>
    </div>
  );
}
