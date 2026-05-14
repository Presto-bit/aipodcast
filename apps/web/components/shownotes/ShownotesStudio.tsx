"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Music2, Pause, Play, RotateCw, Save, Sparkles, Upload } from "lucide-react";
import {
  fetchClipProjectShareAiCopy,
  fetchClipTitleSuggestions,
  formatOrchestratorErrorText,
  persistClipProjectShowNotes
} from "../../lib/api";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { computeSharePublishHints, reorderShowNotesGoldenQuotesAfterListen } from "../../lib/sharePublishDefaults";
import { SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER } from "../../lib/shareShownotesAiPrompt";
import {
  clipProjectHasMaterial,
  clipProjectMasterAudioSrc,
  isShownotesOnlyClipProject,
  SHOWNOTES_ONLY_CLIP_PROJECT_TITLE
} from "../../lib/shownotesClipProject";
import {
  appendShownotesStudioHistory,
  clearShownotesStudioDraft,
  clearShownotesStudioHistory,
  loadShownotesStudioDraft,
  loadShownotesStudioHistory,
  saveShownotesStudioDraft,
  type ShownotesStudioHistoryItem
} from "../../lib/shownotesStudioHistory";
import { ShowNotesMarkdownPreview } from "../podcast/ShowNotesMarkdownPreview";
import { ShownotesBrandHeading } from "./ShownotesBrandHeading";

export type ShownotesStudioProps = {
  projectId: string;
  /** 落地页嵌入：外层已有标题时可收窄布局 */
  embedOnLanding?: boolean;
  /** 上传时原始文件名（用于一行展示） */
  fileLabel?: string;
  /** 嵌入落地页时：新建工程并上传完成后由外层切换 projectId */
  onReplaceProject?: (projectId: string, fileLabel: string) => void;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

const HISTORY_PAGE_SIZE = 5;

async function patchClipProjectTitle(projectId: string, title: string, getAuthHeaders: () => Record<string, string>) {
  const id = encodeURIComponent(projectId);
  const res = await fetch(`/api/clip/projects/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { ...getAuthHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ title: title.slice(0, 200) })
  });
  const t = await res.text();
  if (!res.ok) {
    throw new Error(formatOrchestratorErrorText(t) || `更新标题失败 ${res.status}`);
  }
}

export default function ShownotesStudio({
  projectId,
  embedOnLanding = false,
  fileLabel = "",
  onReplaceProject
}: ShownotesStudioProps) {
  const router = useRouter();
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const newAudioInputRef = useRef<HTMLInputElement | null>(null);
  /** 用户点击「开始生成」后，转写成功时自动跑标题 + 正文生成 */
  const pendingPipelineAfterAsrRef = useRef(false);
  const postAsrPipelineLockRef = useRef(false);

  const [project, setProject] = useState<ClipProjectRow | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [pipelineMsg, setPipelineMsg] = useState("");
  const [playing, setPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(0);

  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [shareAiBusy, setShareAiBusy] = useState(false);
  const [newAudioBusy, setNewAudioBusy] = useState(false);

  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [selectedTitleIndex, setSelectedTitleIndex] = useState(0);

  const [showNotes, setShowNotes] = useState("");
  const [notesPreviewEdit, setNotesPreviewEdit] = useState(false);

  const [history, setHistory] = useState<ShownotesStudioHistoryItem[]>([]);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiErr, setAiErr] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);

  const draftFlushRef = useRef({ showNotes: "", titleOptions: [] as string[], selectedTitleIndex: 0 });
  draftFlushRef.current = { showNotes, titleOptions, selectedTitleIndex };

  const shownotesRestoreKeyRef = useRef<string>("");
  const materialPollTicksRef = useRef(0);

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; project?: ClipProjectRow; detail?: string };
      if (!res.ok || data.success === false || !data.project) {
        throw new Error(data.detail || `加载失败 ${res.status}`);
      }
      setProject(data.project);
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders, projectId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    void load();
  }, [isLoggedIn, load]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    const tr = (project?.transcription_status || "").toLowerCase();
    const mergeBusy =
      project?.audio_merge_status === "queued" || project?.audio_merge_status === "running";
    const active = mergeBusy || tr === "queued" || tr === "running";
    if (!active) return;
    const id = window.setInterval(() => {
      if (!cancelled) void load();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLoggedIn, load, project?.audio_merge_status, project?.transcription_status]);

  useEffect(() => {
    materialPollTicksRef.current = 0;
  }, [projectId]);

  /** stage 上传完成前首次 GET 可能仍无素材；在转写/合并未激活时也要轮询刷新 */
  useEffect(() => {
    if (!isLoggedIn || !project) return;
    if (clipProjectHasMaterial(project)) {
      materialPollTicksRef.current = 0;
      return;
    }
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      materialPollTicksRef.current += 1;
      if (materialPollTicksRef.current > 80) {
        window.clearInterval(id);
        return;
      }
      void load();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLoggedIn, load, project, projectId]);

  useEffect(() => {
    shownotesRestoreKeyRef.current = "";
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    if (shownotesRestoreKeyRef.current === projectId) return;
    shownotesRestoreKeyRef.current = projectId;

    const serverNotes = String(project.shownotes_markdown || "").trim();
    const draft = loadShownotesStudioDraft(projectId);
    const srvTime = Date.parse(String(project.updated_at || "")) || 0;

    if (draft?.showNotes?.trim()) {
      const draftTime = Date.parse(draft.updatedAt) || 0;
      const preferDraft = Number.isFinite(draftTime) && (draftTime >= srvTime - 3000 || !serverNotes);
      if (preferDraft) {
        setShowNotes(draft.showNotes);
        if (draft.titles.length > 0) {
          setTitleOptions(draft.titles.slice(0, 3));
          setSelectedTitleIndex(Math.min(draft.selectedTitleIndex, Math.max(0, draft.titles.length - 1)));
        }
        setNotesPreviewEdit(false);
        return;
      }
    }
    if (serverNotes) {
      setShowNotes(serverNotes);
      setNotesPreviewEdit(false);
    }
  }, [project, projectId]);

  useEffect(() => {
    setHistory(loadShownotesStudioHistory(projectId));
    setHistoryPage(0);
  }, [projectId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    setHistoryPage((p) => Math.min(p, totalPages - 1));
  }, [history.length]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const { showNotes: sn, titleOptions: to, selectedTitleIndex: si } = draftFlushRef.current;
      saveShownotesStudioDraft(projectId, { showNotes: sn, titles: to, selectedTitleIndex: si });
    }, 500);
    return () => window.clearTimeout(t);
  }, [projectId, showNotes, titleOptions, selectedTitleIndex]);

  useEffect(() => {
    const flush = () => {
      const { showNotes: sn, titleOptions: to, selectedTitleIndex: si } = draftFlushRef.current;
      saveShownotesStudioDraft(projectId, { showNotes: sn, titles: to, selectedTitleIndex: si });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [projectId]);

  const runTranscribe = useCallback(async () => {
    setTranscribeBusy(true);
    setPipelineMsg("正在提交语音转写…");
    setLoadErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/transcribe`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ mode: "full" })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) throw new Error(data.detail || `转写提交失败 ${res.status}`);
      setPipelineMsg("转写进行中，请稍候…");
      await load();
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
      setPipelineMsg("");
    } finally {
      setTranscribeBusy(false);
    }
  }, [getAuthHeaders, load, projectId]);

  const runFetchTitles = useCallback(async (): Promise<string[]> => {
    setTitleBusy(true);
    setLoadErr("");
    try {
      const data = await fetchClipTitleSuggestions(projectId);
      const titles = (data.titles || []).filter(Boolean);
      const list = titles.slice(0, 3);
      setTitleOptions(list);
      setSelectedTitleIndex(0);
      return list;
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
      return [];
    } finally {
      setTitleBusy(false);
    }
  }, [projectId]);

  const runGenShownotes = useCallback(
    async (titlesSnapshot?: string[]) => {
      setGenBusy(true);
      setPipelineMsg("正在根据转写稿生成 Shownotes…");
      setLoadErr("");
      try {
        const data = await fetchClipProjectShareAiCopy(projectId);
        if (!data.success) throw new Error("生成未成功");
        const notes = String(data.show_notes ?? "").trim();
        if (!notes) throw new Error("返回的 Shownotes 为空");
        setShowNotes(notes);
        setNotesPreviewEdit(false);
        await persistClipProjectShowNotes(projectId, String(notes ?? "").slice(0, 20_000));
        const snap = (titlesSnapshot ?? titleOptions).map((x) => String(x || "").trim()).filter(Boolean);
        const titlesSnap = snap.length ? snap : [""];
        const histIdx = titlesSnapshot != null ? 0 : selectedTitleIndex;
        const nextHist = appendShownotesStudioHistory(projectId, {
          titles: titlesSnap,
          selectedTitleIndex: histIdx,
          showNotes: notes
        });
        setHistory(nextHist);
        clearShownotesStudioDraft(projectId);
        await load();
        setPipelineMsg("");
      } catch (e) {
        setLoadErr(String(e instanceof Error ? e.message : e));
        setPipelineMsg("");
      } finally {
        setGenBusy(false);
      }
    },
    [load, projectId, selectedTitleIndex, titleOptions]
  );

  const runPostAsrPipeline = useCallback(async () => {
    if (postAsrPipelineLockRef.current) return;
    postAsrPipelineLockRef.current = true;
    try {
      const titles = await runFetchTitles();
      await runGenShownotes(titles);
    } finally {
      postAsrPipelineLockRef.current = false;
    }
  }, [runFetchTitles, runGenShownotes]);

  useEffect(() => {
    if (project?.transcription_status !== "succeeded") return;
    if (!pendingPipelineAfterAsrRef.current) return;
    pendingPipelineAfterAsrRef.current = false;
    void runPostAsrPipeline();
  }, [project?.transcription_status, runPostAsrPipeline]);

  const trLower = (project?.transcription_status || "").toLowerCase();
  const transcribeOk = project?.transcription_status === "succeeded";
  const mergeBusy =
    project?.audio_merge_status === "queued" || project?.audio_merge_status === "running";
  const trRunning = trLower === "queued" || trLower === "running";
  const hasMaterial = clipProjectHasMaterial(project);

  const displayName = useMemo(() => {
    const f = fileLabel.trim();
    if (f) return f;
    const t = String(project?.title || "").trim();
    if (t && !isShownotesOnlyClipProject({ title: t })) return t;
    return "已上传音频";
  }, [fileLabel, project?.title]);

  const audioSrc = useMemo(() => {
    if (!project) return null;
    return clipProjectMasterAudioSrc(projectId, project);
  }, [project, projectId]);

  const hints = useMemo(
    () => computeSharePublishHints(project?.title || "播客", "", showNotes),
    [project?.title, showNotes]
  );

  const previewMarkdown = useMemo(
    () => reorderShowNotesGoldenQuotesAfterListen(showNotes),
    [showNotes]
  );

  const onSeekSeconds = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    void el.play().catch(() => {});
  }, []);

  const onSaveShowNotes = useCallback(async () => {
    setSaveBusy(true);
    setLoadErr("");
    try {
      await persistClipProjectShowNotes(projectId, String(showNotes ?? "").slice(0, 20_000));
      clearShownotesStudioDraft(projectId);
      const titlesSnap = titleOptions.length ? titleOptions : [""];
      const nextHist = appendShownotesStudioHistory(projectId, {
        titles: titlesSnap,
        selectedTitleIndex,
        showNotes
      });
      setHistory(nextHist);
      await load();
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaveBusy(false);
    }
  }, [load, projectId, selectedTitleIndex, showNotes, titleOptions]);

  const applyAiRefine = useCallback(async () => {
    const raw = aiPromptDraft.trim();
    const userPrompt = raw || SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER;
    setShareAiBusy(true);
    setAiErr("");
    try {
      const data = await fetchClipProjectShareAiCopy(projectId, {
        showNotesOnly: true,
        userPrompt,
        baselineShowNotes: showNotes
      });
      if (!data.success) throw new Error("AI 未返回成功");
      const notes = String(data.show_notes ?? "").trim();
      if (!notes) throw new Error("返回内容为空");
      setShowNotes(notes);
      setNotesPreviewEdit(false);
      await persistClipProjectShowNotes(projectId, String(notes ?? "").slice(0, 20_000));
      clearShownotesStudioDraft(projectId);
      const titlesSnap = titleOptions.length ? titleOptions : [""];
      const nextHist = appendShownotesStudioHistory(projectId, {
        titles: titlesSnap,
        selectedTitleIndex,
        showNotes: notes
      });
      setHistory(nextHist);
      await load();
      setAiModalOpen(false);
      setAiPromptDraft("");
    } catch (e) {
      setAiErr(String(e instanceof Error ? e.message : e));
    } finally {
      setShareAiBusy(false);
    }
  }, [aiPromptDraft, load, projectId, selectedTitleIndex, showNotes, titleOptions]);

  const beginAsr = useCallback(() => {
    pendingPipelineAfterAsrRef.current = true;
    void runTranscribe();
  }, [runTranscribe]);

  const onPickTitle = useCallback(
    async (idx: number) => {
      setSelectedTitleIndex(idx);
      const t = titleOptions[idx]?.trim();
      if (!t) return;
      const cur = String(project?.title || "").trim();
      if (t === cur) return;
      try {
        await patchClipProjectTitle(projectId, t, getAuthHeaders);
        await load();
      } catch (e) {
        setLoadErr(String(e instanceof Error ? e.message : e));
      }
    },
    [getAuthHeaders, load, project, projectId, titleOptions]
  );

  const loadHistoryEntry = useCallback((row: ShownotesStudioHistoryItem) => {
    setShowNotes(row.showNotes);
    setTitleOptions(row.titles.filter(Boolean).slice(0, 3));
    setSelectedTitleIndex(Math.min(row.selectedTitleIndex, Math.max(0, row.titles.length - 1)));
    setNotesPreviewEdit(false);
  }, []);

  const startNewAudioFromFile = useCallback(
    async (file: File) => {
      setNewAudioBusy(true);
      setLoadErr("");
      try {
        clearShownotesStudioDraft(projectId);
        clearShownotesStudioHistory(projectId);
        const res = await fetch("/api/clip/projects", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ title: SHOWNOTES_ONLY_CLIP_PROJECT_TITLE })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; project?: { id?: string }; detail?: string };
        if (!res.ok || data.success === false || !data.project?.id) {
          throw new Error(data.detail || `创建任务失败 ${res.status}`);
        }
        const newId = String(data.project.id);
        const stage = await fetch(`/api/clip/projects/${encodeURIComponent(newId)}/audio/stage`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-clip-filename": encodeClipFilenameForHttpHeader(file.name || "audio.mp3", "segment.mp3"),
            ...getAuthHeaders()
          },
          body: file
        });
        const stData = (await stage.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!stage.ok || stData.success === false) {
          throw new Error(stData.detail || `上传失败 ${stage.status}`);
        }
        const label = file.name || "audio";
        if (embedOnLanding && onReplaceProject) onReplaceProject(newId, label);
        else router.replace(`/shownotes/make/${encodeURIComponent(newId)}`);
      } catch (e) {
        setLoadErr(String(e instanceof Error ? e.message : e));
      } finally {
        setNewAudioBusy(false);
        if (newAudioInputRef.current) newAudioInputRef.current.value = "";
      }
    },
    [embedOnLanding, getAuthHeaders, onReplaceProject, projectId, router]
  );

  const canOfferNewUpload = Boolean(project && (hasMaterial || transcribeOk));

  const historyTotalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const historyPageSafe = Math.min(historyPage, historyTotalPages - 1);
  const pagedHistory = history.slice(
    historyPageSafe * HISTORY_PAGE_SIZE,
    historyPageSafe * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  const inner = (
    <div className="space-y-6">
      {!embedOnLanding ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <ShownotesBrandHeading />
            <p className="mt-1 text-sm text-muted">{displayName}</p>
          </div>
          <Link href="/shownotes" className="text-sm font-medium text-brand hover:underline">
            返回
          </Link>
        </div>
      ) : null}

      {loadErr || pipelineMsg ? (
        <div className="text-sm">
          {loadErr ? <p className="text-danger-ink">{loadErr}</p> : null}
          {pipelineMsg ? (
            <p className={loadErr ? "mt-1 text-ink" : "text-ink"} role="status">
              {pipelineMsg}
            </p>
          ) : null}
        </div>
      ) : null}

      {mergeBusy ? <p className="text-sm text-muted">正在处理音频，请稍候…</p> : null}

      {!project ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : project && !hasMaterial && !mergeBusy ? (
        <p className="text-sm text-muted">正在等待音频素材，请稍候…</p>
      ) : null}

      {hasMaterial && audioSrc ? (
        <section aria-label="音频" className="border-b border-line/50 pb-6">
          <div className="flex flex-wrap items-center gap-2.5 py-1">
            <input
              ref={newAudioInputRef}
              type="file"
              className="sr-only"
              accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
              disabled={newAudioBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void startNewAudioFromFile(f);
              }}
            />
            <Music2 className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <audio
              ref={audioRef}
              className="hidden"
              src={audioSrc}
              preload="metadata"
              onLoadedMetadata={() => {
                const d = audioRef.current?.duration;
                setDurationSec(Number.isFinite(d) ? d || 0 : 0);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill/80 text-ink hover:bg-fill"
              aria-label={playing ? "暂停" : "播放"}
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                if (playing) el.pause();
                else void el.play().catch(() => {});
              }}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={displayName}>
              {displayName}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{formatDuration(durationSec)}</span>
            <button
              type="button"
              disabled={transcribeBusy || !hasMaterial || trRunning || mergeBusy || transcribeOk}
              onClick={beginAsr}
              className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-50"
              title={transcribeOk ? "转写已完成" : undefined}
            >
              {transcribeBusy || trRunning ? "转写中…" : transcribeOk ? "已转写" : "开始生成"}
            </button>
            {canOfferNewUpload ? (
              <button
                type="button"
                disabled={newAudioBusy || transcribeBusy || trRunning || mergeBusy || genBusy || shareAiBusy}
                onClick={() => newAudioInputRef.current?.click()}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                {newAudioBusy ? "处理中…" : "上传新音频"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="max-w-3xl space-y-0">
        {transcribeOk ? (
          <>
            <section aria-label="标题" className="border-b border-line/50 py-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">标题</h2>
                <button
                  type="button"
                  disabled={titleBusy || genBusy}
                  onClick={() => void runFetchTitles()}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${titleBusy ? "animate-spin" : ""}`} />
                  重新生成标题
                </button>
              </div>
              <ul className="mt-3 space-y-1">
                {(titleOptions.length ? titleOptions : ["", "", ""]).slice(0, 3).map((t, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-fill/40">
                      <input
                        type="radio"
                        name={`sn-title-${projectId}`}
                        className="mt-1"
                        checked={selectedTitleIndex === i}
                        onChange={() => void onPickTitle(i)}
                        disabled={!t.trim()}
                      />
                      <span className="text-sm leading-snug text-ink">{t.trim() || (titleBusy ? "生成中…" : "—")}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Shownotes" className="border-b border-line/50 py-6">
              <h2 className="mb-3 text-sm font-semibold text-ink">Shownotes</h2>
              <div className="rounded-2xl border border-line/60 bg-fill/10 p-5 shadow-md sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={genBusy || shareAiBusy}
                    onClick={() => {
                      setAiErr("");
                      setAiModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden />
                    {shareAiBusy ? "处理中…" : "AI 优化"}
                  </button>
                  <button
                    type="button"
                    disabled={saveBusy || genBusy}
                    onClick={() => void onSaveShowNotes()}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saveBusy ? "保存中…" : "保存"}
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] text-muted">双击预览区域进入编辑；支持 Markdown。</p>
                  {notesPreviewEdit ? (
                    <textarea
                      className="min-h-[16rem] w-full rounded-xl bg-fill/30 px-3 py-2.5 text-sm leading-relaxed text-ink"
                      value={showNotes}
                      onChange={(e) => setShowNotes(e.target.value)}
                      maxLength={20_000}
                    />
                  ) : (
                    <div
                      className="max-h-[min(70vh,28rem)] cursor-text overflow-y-auto rounded-xl bg-fill/20 p-4"
                      onDoubleClick={() => setNotesPreviewEdit(true)}
                    >
                      <ShowNotesMarkdownPreview
                        markdown={previewMarkdown}
                        onSeekSeconds={onSeekSeconds}
                        className="!max-h-none overflow-visible border-0 bg-transparent p-0"
                      />
                    </div>
                  )}
                  {notesPreviewEdit ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-brand hover:underline"
                      onClick={() => setNotesPreviewEdit(false)}
                    >
                      完成编辑
                    </button>
                  ) : null}
                </div>

                {hints.showNotesVeryShort && showNotes.trim() ? (
                  <p className="mt-3 text-[11px] text-warning-ink">Shownotes 偏短。</p>
                ) : null}
              </div>
            </section>

            <section aria-label="历史记录" className="pt-2">
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-semibold text-ink hover:text-brand"
              >
                <span>历史记录（{history.length} 条）</span>
                {historyOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
              </button>
              {historyOpen ? (
                <div className="mt-1">
                  <ul className="space-y-1">
                    {history.length === 0 ? (
                      <li className="text-xs text-muted">暂无记录</li>
                    ) : (
                      pagedHistory.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => loadHistoryEntry(h)}
                            className="w-full rounded-md px-2 py-2 text-left text-xs transition hover:bg-fill/40"
                          >
                            <span className="block font-medium text-ink line-clamp-2">
                              {h.titles[h.selectedTitleIndex]?.trim() || "（无标题）"}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-muted">
                              {new Date(h.savedAt).toLocaleString("zh-CN", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  {history.length > HISTORY_PAGE_SIZE ? (
                    <div className="mt-3 flex items-center justify-between text-xs text-muted">
                      <button
                        type="button"
                        disabled={historyPageSafe <= 0}
                        onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                        className="font-medium text-brand hover:underline disabled:opacity-40 disabled:hover:no-underline"
                      >
                        上一页
                      </button>
                      <span className="tabular-nums">
                        {historyPageSafe + 1} / {historyTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={historyPageSafe >= historyTotalPages - 1}
                        onClick={() =>
                          setHistoryPage((p) => {
                            const tp = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
                            return Math.min(tp - 1, p + 1);
                          })
                        }
                        className="font-medium text-brand hover:underline disabled:opacity-40 disabled:hover:no-underline"
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </>
        ) : hasMaterial ? (
          <p className="py-6 text-sm text-muted">转写完成后将显示标题候选与 Shownotes 编辑区。</p>
        ) : null}
      </div>

      {aiModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fym-workspace-scrim z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="关闭"
                onClick={() => {
                  setAiModalOpen(false);
                  setAiErr("");
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="sn-studio-ai-title"
                className="relative z-10 w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="sn-studio-ai-title" className="inline-flex items-center gap-2 text-base font-semibold text-ink">
                  <Sparkles className="h-4 w-4 text-brand" />
                  AI 优化 Shownotes
                </h2>
                <label className="mt-4 block text-sm text-muted">
                  优化说明
                  <textarea
                    className="mt-1 min-h-[7rem] w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-muted/60"
                    value={aiPromptDraft}
                    placeholder={SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER}
                    onChange={(e) => {
                      setAiPromptDraft(e.target.value);
                      setAiErr("");
                    }}
                  />
                </label>
                {aiErr ? <p className="mt-2 text-sm text-danger-ink">{aiErr}</p> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-fill/40 px-4 py-2 text-sm text-ink hover:bg-fill"
                    onClick={() => {
                      setAiModalOpen(false);
                      setAiErr("");
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
                    disabled={shareAiBusy}
                    onClick={() => void applyAiRefine()}
                  >
                    {shareAiBusy ? "生成中…" : "生成"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );

  if (embedOnLanding) {
    if (!isLoggedIn) return null;
    return inner;
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-muted">加载中…</p>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-muted">请先登录。</p>
        <Link href="/home" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          前往工作台
        </Link>
      </main>
    );
  }

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{inner}</main>;
}
