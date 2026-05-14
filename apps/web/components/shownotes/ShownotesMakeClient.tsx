"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClipProjectShareAiCopy, persistClipProjectShowNotes } from "../../lib/api";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { computeSharePublishHints } from "../../lib/sharePublishDefaults";
import { SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER } from "../../lib/shareShownotesAiPrompt";
import { clipProjectHasMaterial, clipProjectMasterAudioSrc } from "../../lib/shownotesClipProject";
import { WorkHubShownotesSection } from "../works/WorkHubShownotesSection";

export type ShownotesMakeClientProps = {
  projectId: string;
  /** 嵌入落地页：不占 `<main>`、不展示剪辑相关入口 */
  embedOnLanding?: boolean;
  /** 转写完成前仅展示进度/错误，不展示 Shownotes 编辑区与试听（落地页用） */
  deferNotesUiUntilTranscribeOk?: boolean;
};

export default function ShownotesMakeClient({
  projectId,
  embedOnLanding = false,
  deferNotesUiUntilTranscribeOk = false
}: ShownotesMakeClientProps) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notesUserEditedRef = useRef(false);
  const autoTranscribeAttemptedRef = useRef(false);
  const autoGenAttemptedRef = useRef(false);

  const [project, setProject] = useState<ClipProjectRow | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [showNotes, setShowNotes] = useState("");
  const [notesTab, setNotesTab] = useState<"preview" | "edit" | "ai">("preview");
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [shareAiBusy, setShareAiBusy] = useState(false);
  const [pipelineMsg, setPipelineMsg] = useState("");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiErr, setAiErr] = useState("");

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
    const s = String(project?.shownotes_markdown || "").trim();
    if (!s || notesUserEditedRef.current) return;
    setShowNotes(s);
    setNotesTab("preview");
  }, [project?.shownotes_markdown]);

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
      autoTranscribeAttemptedRef.current = false;
      setLoadErr(String(e instanceof Error ? e.message : e));
      setPipelineMsg("");
    } finally {
      setTranscribeBusy(false);
    }
  }, [getAuthHeaders, load, projectId]);

  const runGenShownotes = useCallback(async () => {
    setGenBusy(true);
    setPipelineMsg("正在根据转写稿生成 Shownotes…");
    setLoadErr("");
    try {
      const data = await fetchClipProjectShareAiCopy(projectId);
      if (!data.success) throw new Error("生成未成功");
      const notes = String(data.show_notes ?? "").trim();
      if (!notes) throw new Error("返回的 Shownotes 为空");
      setShowNotes(notes);
      setNotesTab("preview");
      await persistClipProjectShowNotes(projectId, notes);
      await load();
      setPipelineMsg("");
    } catch (e) {
      autoGenAttemptedRef.current = false;
      setLoadErr(String(e instanceof Error ? e.message : e));
      setPipelineMsg("");
    } finally {
      setGenBusy(false);
    }
  }, [load, projectId]);

  useEffect(() => {
    if (!project) return;
    const mergeBusy =
      project.audio_merge_status === "queued" || project.audio_merge_status === "running";
    if (mergeBusy) {
      setPipelineMsg("正在处理音频，请稍候…");
      return;
    }
    if (!clipProjectHasMaterial(project)) return;
    const tr = (project.transcription_status || "").toLowerCase();
    if (tr === "queued" || tr === "running") {
      setPipelineMsg("语音转写进行中…");
      return;
    }
    if (tr === "succeeded") {
      setPipelineMsg("");
      return;
    }
    if (tr === "failed") {
      setPipelineMsg("转写未成功，可重试。");
      return;
    }
    if (autoTranscribeAttemptedRef.current) return;
    autoTranscribeAttemptedRef.current = true;
    void runTranscribe();
  }, [project, runTranscribe]);

  useEffect(() => {
    if (!project || project.transcription_status !== "succeeded") return;
    if (notesUserEditedRef.current) return;
    const existing = String(project.shownotes_markdown || "").trim();
    if (existing) return;
    if (showNotes.trim()) return;
    if (autoGenAttemptedRef.current) return;
    autoGenAttemptedRef.current = true;
    void runGenShownotes();
  }, [project, runGenShownotes, showNotes]);

  const hints = useMemo(
    () => computeSharePublishHints(project?.title || "播客", "", showNotes),
    [project?.title, showNotes]
  );

  const audioSrc = useMemo(() => {
    if (!project) return null;
    return clipProjectMasterAudioSrc(projectId, project);
  }, [project, projectId]);

  const onSeekSeconds = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    void el.play().catch(() => {});
  }, []);

  const onShowNotesChange = useCallback((next: string) => {
    notesUserEditedRef.current = true;
    setShowNotes(next);
  }, []);

  const onSaveShowNotes = useCallback(async () => {
    setSaveBusy(true);
    setLoadErr("");
    try {
      await persistClipProjectShowNotes(projectId, showNotes);
      await load();
    } catch (e) {
      setLoadErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaveBusy(false);
    }
  }, [load, projectId, showNotes]);

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
      notesUserEditedRef.current = true;
      setShowNotes(notes);
      setNotesTab("preview");
      setAiModalOpen(false);
      setAiPromptDraft("");
    } catch (e) {
      setAiErr(String(e instanceof Error ? e.message : e));
    } finally {
      setShareAiBusy(false);
    }
  }, [aiPromptDraft, projectId, showNotes]);

  const tr = (project?.transcription_status || "").toLowerCase();
  const jobGenerating = tr === "queued" || tr === "running";
  const transcribeOk = project?.transcription_status === "succeeded";
  const showFullNotesUi = !deferNotesUiUntilTranscribeOk || transcribeOk;

  const inner = (
    <div className="space-y-6">
      {!embedOnLanding ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Shownotes</h1>
            <p className="mt-1 text-sm text-muted">{project?.title || "当前任务"}</p>
          </div>
          <Link href="/shownotes" className="text-sm font-medium text-brand hover:underline">
            返回 Shownotes 首页
          </Link>
        </div>
      ) : null}

      {loadErr ? (
        <p className="rounded-lg border border-danger/30 bg-danger-soft/40 px-3 py-2 text-sm text-danger-ink">{loadErr}</p>
      ) : null}
      {pipelineMsg ? (
        <p className="rounded-lg border border-line bg-fill/50 px-3 py-2 text-sm text-ink" role="status">
          {pipelineMsg}
        </p>
      ) : null}

      {showFullNotesUi && transcribeOk && audioSrc ? (
        <div>
          <p className="text-xs font-medium text-muted">试听（Shownotes 时间戳可跳转）</p>
          <audio ref={audioRef} controls className="mt-2 w-full max-w-xl" src={audioSrc} preload="metadata" />
        </div>
      ) : null}

      {showFullNotesUi && transcribeOk ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={transcribeBusy || !clipProjectHasMaterial(project) || tr === "queued" || tr === "running"}
            onClick={() => {
              autoTranscribeAttemptedRef.current = true;
              void runTranscribe();
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
          >
            {transcribeBusy ? "提交中…" : "重新转写"}
          </button>
          <button
            type="button"
            disabled={genBusy || project?.transcription_status !== "succeeded"}
            onClick={() => {
              autoGenAttemptedRef.current = true;
              void runGenShownotes();
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
          >
            {genBusy ? "生成中…" : "重新生成 Shownotes"}
          </button>
        </div>
      ) : null}

      {!showFullNotesUi && tr === "failed" ? (
        <button
          type="button"
          disabled={transcribeBusy || !clipProjectHasMaterial(project)}
          onClick={() => {
            autoTranscribeAttemptedRef.current = true;
            void runTranscribe();
          }}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
        >
          {transcribeBusy ? "提交中…" : "重试转写"}
        </button>
      ) : null}

      {showFullNotesUi && project ? (
        <WorkHubShownotesSection
          notesTab={notesTab}
          onNotesTab={setNotesTab}
          showNotes={showNotes}
          onShowNotesChange={onShowNotesChange}
          onSaveShowNotes={() => void onSaveShowNotes()}
          onOpenAiModal={() => {
            setAiErr("");
            setAiModalOpen(true);
          }}
          hints={hints}
          hasAudio={Boolean(audioSrc)}
          onSeekSeconds={onSeekSeconds}
          busy={transcribeBusy || genBusy}
          shareAiBusy={shareAiBusy}
          showNotesSaveBusy={saveBusy}
          scriptResolvePending={false}
          hasOwner={isLoggedIn}
          jobGenerating={jobGenerating || genBusy}
        />
      ) : !showFullNotesUi && project && !loadErr ? (
        <p className="text-sm text-muted">转写完成后将在此处展示 Shownotes，与作品详情页一致。</p>
      ) : !project && !loadErr ? (
        <p className="text-sm text-muted">加载任务…</p>
      ) : null}

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
                aria-labelledby="shownotes-make-ai-title"
                className="relative z-10 w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="shownotes-make-ai-title" className="text-base font-semibold text-ink">
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
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">加载中…</p>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">请先登录。</p>
        <Link href="/home" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          前往工作台
        </Link>
      </main>
    );
  }

  return <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">{inner}</main>;
}
