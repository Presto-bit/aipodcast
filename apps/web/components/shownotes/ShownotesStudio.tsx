"use client";

import Link from "next/link";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import { FileText, Music2, RotateCw, Save, Sparkles } from "../icons";
import { IconPause, IconPlayFilled } from "../icons";
import {
  fetchClipProjectShareAiCopy,
  fetchClipTitleSuggestions,
  persistClipProjectShowNotes
} from "../../lib/api";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import { clipProjectTranscriptPlainText } from "../../lib/clipTranscriptPlainText";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { computeSharePublishHints, reorderShowNotesGoldenQuotesAfterListen } from "../../lib/sharePublishDefaults";
import { SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER } from "../../lib/shareShownotesAiPrompt";
import {
  clearShownotesPendingPipeline,
  clipProjectHasMaterial,
  clipProjectMasterAudioSrc,
  hasShownotesPendingPipeline,
  markShownotesPendingPipeline,
  shownotesProjectDisplayTitle
} from "../../lib/shownotesClipProject";
import {
  clearShownotesStudioDraft,
  loadShownotesStudioDraft,
  saveShownotesStudioDraft
} from "../../lib/shownotesStudioHistory";
import { ShowNotesMarkdownPreview } from "../podcast/ShowNotesMarkdownPreview";
import { ShownotesBrandHeading } from "./ShownotesBrandHeading";

export type ShownotesStudioProps = {
  projectId: string;
  /** 落地页嵌入：外层已有标题时可收窄布局 */
  embedOnLanding?: boolean;
  /** 上传时原始文件名（用于一行展示） */
  fileLabel?: string;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function ShownotesStudio({
  projectId,
  embedOnLanding = false,
  fileLabel = ""
}: ShownotesStudioProps) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
  const [titleOptions, setTitleOptions] = useState<string[]>([]);

  const [showNotes, setShowNotes] = useState("");
  const [notesPreviewEdit, setNotesPreviewEdit] = useState(false);

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiErr, setAiErr] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const draftFlushRef = useRef({ showNotes: "", titleOptions: [] as string[] });
  draftFlushRef.current = { showNotes, titleOptions };

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
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  useEffect(() => {
    if (!project) return;
    const tr = (project.transcription_status || "").toLowerCase();
    if (tr === "queued" || tr === "running") {
      setPipelineMsg("转写进行中，请稍候…");
      return;
    }
    if (tr === "failed") {
      clearShownotesPendingPipeline(projectId);
      pendingPipelineAfterAsrRef.current = false;
    }
    setPipelineMsg((msg) => (msg === "转写进行中，请稍候…" ? "" : msg));
  }, [project, projectId]);

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
    const t = window.setTimeout(() => {
      const { showNotes: sn, titleOptions: to } = draftFlushRef.current;
      saveShownotesStudioDraft(projectId, { showNotes: sn, titles: to, selectedTitleIndex: 0 });
    }, 500);
    return () => window.clearTimeout(t);
  }, [projectId, showNotes, titleOptions]);

  useEffect(() => {
    const flush = () => {
      const { showNotes: sn, titleOptions: to } = draftFlushRef.current;
      saveShownotesStudioDraft(projectId, { showNotes: sn, titles: to, selectedTitleIndex: 0 });
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
      markShownotesPendingPipeline(projectId);
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
        const notes =
          String(data.show_notes ?? "").trim() || String(data.summary ?? "").trim();
        if (!notes) throw new Error("返回的 Shownotes 为空");
        setShowNotes(notes);
        setNotesPreviewEdit(false);
        await persistClipProjectShowNotes(projectId, String(notes ?? "").slice(0, 20_000));
        clearShownotesStudioDraft(projectId);
        await load();
        setPipelineMsg("");
        clearShownotesPendingPipeline(projectId);
      } catch (e) {
        setLoadErr(String(e instanceof Error ? e.message : e));
        setPipelineMsg("");
      } finally {
        setGenBusy(false);
      }
    },
    [load, projectId]
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
    const pending = pendingPipelineAfterAsrRef.current || hasShownotesPendingPipeline(projectId);
    if (!pending) return;
    pendingPipelineAfterAsrRef.current = false;
    void runPostAsrPipeline();
  }, [project?.transcription_status, projectId, runPostAsrPipeline]);

  const trLower = (project?.transcription_status || "").toLowerCase();
  const transcribeOk = project?.transcription_status === "succeeded";
  const mergeBusy =
    project?.audio_merge_status === "queued" || project?.audio_merge_status === "running";
  const trRunning = trLower === "queued" || trLower === "running";
  const hasMaterial = clipProjectHasMaterial(project);

  const displayName = useMemo(() => {
    const f = fileLabel.trim();
    if (f) return f;
    if (project) return shownotesProjectDisplayTitle(project);
    return "已上传音频";
  }, [fileLabel, project]);

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

  const transcriptPlainText = useMemo(() => clipProjectTranscriptPlainText(project), [project]);

  useEffect(() => {
    setTranscriptOpen(false);
  }, [projectId]);

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
      await load();
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaveBusy(false);
    }
  }, [load, projectId, showNotes, titleOptions]);

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
      const notes =
        String(data.show_notes ?? "").trim() || String(data.summary ?? "").trim();
      if (!notes) throw new Error("返回内容为空");
      setShowNotes(notes);
      setNotesPreviewEdit(false);
      await persistClipProjectShowNotes(projectId, String(notes ?? "").slice(0, 20_000));
      clearShownotesStudioDraft(projectId);
      await load();
      setAiModalOpen(false);
      setAiPromptDraft("");
    } catch (e) {
      setAiErr(String(e instanceof Error ? e.message : e));
    } finally {
      setShareAiBusy(false);
    }
  }, [aiPromptDraft, load, projectId, showNotes, titleOptions]);

  const beginAsr = useCallback(() => {
    pendingPipelineAfterAsrRef.current = true;
    markShownotesPendingPipeline(projectId);
    void runTranscribe();
  }, [projectId, runTranscribe]);

  const inner = (
    <div className={embedOnLanding ? "max-w-3xl space-y-6" : "space-y-6"}>
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
              {playing ? <IconPause className="h-4 w-4" /> : <IconPlayFilled className="h-4 w-4 translate-x-px" />}
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
          </div>
        </section>
      ) : null}

      <div className={embedOnLanding ? "space-y-0" : "max-w-3xl space-y-0"}>
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
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-snug text-ink">
                {(titleOptions.length ? titleOptions : ["", "", ""]).slice(0, 3).map((t, i) => (
                  <li key={i} className="pl-1 marker:text-muted">
                    {t.trim() || (titleBusy ? "生成中…" : "—")}
                  </li>
                ))}
              </ol>
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
                  <button
                    type="button"
                    disabled={!transcriptPlainText}
                    title={transcriptPlainText ? "查看转写原文" : "转写完成后可查看原文"}
                    aria-label="查看原文"
                    aria-pressed={transcriptOpen}
                    onClick={() => setTranscriptOpen((o) => !o)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-fill disabled:opacity-50 ${
                      transcriptOpen ? "bg-fill text-brand" : "text-ink"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    查看原文
                  </button>
                </div>

                {transcriptOpen ? (
                  <div
                    className="mb-3 max-h-[min(50vh,20rem)] overflow-y-auto rounded-xl border border-line/60 bg-fill/25 p-4"
                    aria-label="转写原文"
                  >
                    {transcriptPlainText ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{transcriptPlainText}</pre>
                    ) : (
                      <p className="text-sm text-muted">暂无转写文稿。</p>
                    )}
                  </div>
                ) : null}

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
          </>
        ) : hasMaterial ? (
          <p className="py-6 text-sm text-muted">转写完成后将显示标题候选与 Shownotes 编辑区。</p>
        ) : null}
      </div>

      <WorkspaceScrimModal
        open={aiModalOpen}
        onClose={() => {
          setAiModalOpen(false);
          setAiErr("");
        }}
        labelledBy="sn-studio-ai-title"
        align="end"
        scrimTone="40"
        busy={shareAiBusy}
      >
        <div
          role="document"
          className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-card"
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
      </WorkspaceScrimModal>
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
        <Link href={WORKBENCH_HOME_PATH} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          前往工作台
        </Link>
      </main>
    );
  }

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{inner}</main>;
}
