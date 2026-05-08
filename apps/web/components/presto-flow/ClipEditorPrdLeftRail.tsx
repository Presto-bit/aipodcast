"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClipAudioStagingEntry, ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import { fetchClipProjectShareAiCopy } from "../../lib/api";
import { SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER } from "../../lib/shareShownotesAiPrompt";
import ClipStagingTracksBar from "./ClipStagingTracksBar";
import PrestoFlowImportBar from "./PrestoFlowImportBar";

type Tab = "materials" | "dictionary" | "shownotes";

function shownotesStorageKey(projectId: string): string {
  return `clip-editor-prd-shownotes:${projectId}`;
}

type Props = {
  projectId: string;
  project: ClipProjectRow;
  setProject: (p: ClipProjectRow | ((prev: ClipProjectRow | null) => ClipProjectRow | null)) => void;
  getAuthHeaders: () => Record<string, string>;
  audioStagingEntries: readonly ClipAudioStagingEntry[];
  load: () => Promise<void>;
  setErr: (msg: string) => void;
  hasServerAudio: boolean;
  loggedIn: boolean;
  actionBusy: boolean;
  transcriptionActive: boolean;
  exportActive: boolean;
  pendingInsertedSegments: number;
  transcribeDisabled: boolean;
  transcribeLabel: string;
  onTranscribe: () => void;
  allowMultiSegmentImport: boolean;
  approxSegmentDurationMs: number | null;
};

export default function ClipEditorPrdLeftRail({
  projectId,
  project,
  setProject,
  getAuthHeaders,
  audioStagingEntries,
  load,
  setErr,
  hasServerAudio,
  loggedIn,
  actionBusy,
  transcriptionActive,
  exportActive,
  pendingInsertedSegments,
  transcribeDisabled,
  transcribeLabel,
  onTranscribe,
  allowMultiSegmentImport,
  approxSegmentDurationMs
}: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("materials");

  const entries = Array.isArray(audioStagingEntries) ? audioStagingEntries : [];

  const hotwordLines = useMemo(() => {
    const arr = Array.isArray(project.asr_corpus_hotwords) ? project.asr_corpus_hotwords : [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  }, [project.asr_corpus_hotwords]);

  const [dictDraft, setDictDraft] = useState(() => hotwordLines.join("\n"));
  const [dictBusy, setDictBusy] = useState(false);

  useEffect(() => {
    setDictDraft(hotwordLines.join("\n"));
  }, [hotwordLines]);

  const [notesDraft, setNotesDraft] = useState("");
  const [notesGenBusy, setNotesGenBusy] = useState(false);
  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refinePromptDraft, setRefinePromptDraft] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(shownotesStorageKey(projectId));
      setNotesDraft(raw ?? "");
    } catch {
      setNotesDraft("");
    }
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(shownotesStorageKey(projectId), notesDraft);
    } catch {
      /* ignore */
    }
  }, [projectId, notesDraft]);

  const saveDictionary = useCallback(async () => {
    setDictBusy(true);
    setErr("");
    const lines = dictDraft
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ asr_corpus_hotwords: lines })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        project?: ClipProjectRow;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `保存失败 ${res.status}`);
      }
      if (data.project) setProject(data.project);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDictBusy(false);
    }
  }, [dictDraft, getAuthHeaders, load, projectId, setErr, setProject]);

  const generateShownotes = useCallback(async () => {
    if (project.transcription_status !== "succeeded") return;
    setNotesGenBusy(true);
    setErr("");
    try {
      const data = await fetchClipProjectShareAiCopy(projectId);
      if (!data.success) {
        throw new Error("服务端未返回成功状态");
      }
      const notes = String(data.show_notes ?? "").trim();
      if (!notes) {
        throw new Error("返回的 Shownotes 为空");
      }
      setNotesDraft(notes);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setNotesGenBusy(false);
    }
  }, [project.transcription_status, projectId, setErr]);

  const refineShownotesWithPrompt = useCallback(async () => {
    if (project.transcription_status !== "succeeded") return;
    setNotesGenBusy(true);
    setErr("");
    try {
      const promptRaw = refinePromptDraft.trim();
      const userPrompt = promptRaw || SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER;
      const data = await fetchClipProjectShareAiCopy(projectId, {
        showNotesOnly: true,
        userPrompt,
        baselineShowNotes: notesDraft.trim()
      });
      if (!data.success) {
        throw new Error("服务端未返回成功状态");
      }
      const notes = String(data.show_notes ?? "").trim();
      if (!notes) {
        throw new Error("返回的 Shownotes 为空");
      }
      setNotesDraft(notes);
      setRefineModalOpen(false);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setNotesGenBusy(false);
    }
  }, [
    notesDraft,
    project.transcription_status,
    projectId,
    refinePromptDraft,
    setErr
  ]);

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={[
        "rounded-md px-2 py-1 text-[11px] font-medium transition",
        tab === id ? "bg-brand/15 text-brand shadow-sm" : "text-muted hover:bg-fill hover:text-ink"
      ].join(" ")}
    >
      {label}
    </button>
  );

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col border-r border-line bg-surface/95">
        <button
          type="button"
          title="展开功能区"
          aria-label="展开功能区"
          className="flex h-10 w-9 items-center justify-center border-b border-line text-muted hover:bg-fill hover:text-ink"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <aside className="flex w-[min(17.5rem,38vw)] shrink-0 flex-col border-r border-line bg-surface/95 text-ink">
      <div className="flex items-center justify-between gap-1 border-b border-line px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {tabBtn("materials", "素材")}
          {tabBtn("dictionary", "词典")}
          {tabBtn("shownotes", "Shownotes")}
        </div>
        <button
          type="button"
          title="收起功能区"
          aria-label="收起功能区"
          className="rounded-md p-1.5 text-muted hover:bg-fill hover:text-ink"
          onClick={() => setCollapsed(true)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tab === "materials" ? (
          <>
            <div className="flex flex-col gap-2">
              <PrestoFlowImportBar
                variant="inline"
                projectId={projectId}
                getAuthHeaders={getAuthHeaders}
                hasMainAudio={hasServerAudio}
                disabled={!loggedIn || actionBusy || transcriptionActive || exportActive}
                label={t("presto.flow.importAudio")}
                busyLabel={t("presto.flow.importBusy")}
                hint={t("presto.flow.importHint")}
                replaceWarn={t("presto.flow.importReplaceWarn")}
                onDone={() => void load()}
                onError={(msg) => setErr(msg)}
                allowMultiSegment={allowMultiSegmentImport}
              />
              {entries.length > 0 ? (
                <ClipStagingTracksBar
                  projectId={projectId}
                  entries={entries}
                  getAuthHeaders={getAuthHeaders}
                  disabled={actionBusy || transcriptionActive || exportActive}
                  onRefresh={() => void load()}
                  onError={(msg) => setErr(msg)}
                  visualVariant="prd"
                  approxDurationMsPerSegment={approxSegmentDurationMs}
                />
              ) : (
                <p className="text-[10px] leading-snug text-muted">
                  {hasServerAudio ? "已合并主音频；多段时请上传暂存素材。" : "请上传音频后开始转写。"}
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-line pt-2">
              <button
                type="button"
                disabled={transcribeDisabled}
                onClick={onTranscribe}
                className="w-full rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-40"
              >
                {transcribeLabel}
              </button>
              {pendingInsertedSegments > 0 ? (
                <p className="mt-1 text-[9px] text-muted">含 {pendingInsertedSegments} 段新素材待转写</p>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "dictionary" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="text-[10px] leading-snug text-muted">
              每行一词；用于后续转写提示。已转写段落不会因修改此处而自动变更。
            </p>
            <textarea
              value={dictDraft}
              onChange={(e) => setDictDraft(e.target.value)}
              disabled={dictBusy}
              rows={12}
              className="min-h-[8rem] flex-1 resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink placeholder:text-muted"
              placeholder={"示例词\n产品名"}
            />
            <button
              type="button"
              disabled={dictBusy || !loggedIn}
              onClick={() => void saveDictionary()}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-semibold text-ink shadow-soft hover:bg-fill disabled:opacity-40"
            >
              {dictBusy ? "保存中…" : "保存词典"}
            </button>
          </div>
        ) : null}

        {tab === "shownotes" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="text-[10px] leading-snug text-muted">
              默认无内容；草稿保存在本机浏览器。「生成」走分享页同源初稿管线；「按提词重写」与分享页一致，以上方草稿为基准并按你的编辑要求改写。
            </p>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              disabled={notesGenBusy}
              rows={14}
              className="min-h-[10rem] flex-1 resize-y rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-ink"
              placeholder="点击「生成 Shownotes」后填入…"
            />
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={
                  notesGenBusy ||
                  project.transcription_status !== "succeeded" ||
                  !loggedIn
                }
                onClick={() => void generateShownotes()}
                className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-40"
              >
                {notesGenBusy ? "生成中…" : "生成 Shownotes"}
              </button>
              <button
                type="button"
                disabled={
                  notesGenBusy ||
                  project.transcription_status !== "succeeded" ||
                  !loggedIn
                }
                onClick={() => setRefineModalOpen(true)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-medium text-ink shadow-soft hover:bg-fill disabled:opacity-40"
              >
                按提词重写…
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {refineModalOpen ? (
        <div
          className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/40 p-3"
          role="presentation"
          onClick={() => {
            if (!notesGenBusy) setRefineModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-shownotes-refine-title"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-3 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="clip-shownotes-refine-title" className="mb-2 text-sm font-semibold text-ink">
              按提词重写 Shownotes
            </h3>
            <p className="mb-2 text-[10px] leading-snug text-muted">
              与分享页相同逻辑：以上方编辑区当前内容为草稿基准；留空提词时使用与分享页一致的默认示例要求。
            </p>
            <textarea
              value={refinePromptDraft}
              onChange={(e) => setRefinePromptDraft(e.target.value)}
              disabled={notesGenBusy}
              rows={5}
              placeholder={SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER}
              className="mb-3 w-full resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink placeholder:text-muted"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={notesGenBusy}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-muted hover:bg-fill disabled:opacity-40"
                onClick={() => setRefineModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={notesGenBusy || !loggedIn}
                className="rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-40"
                onClick={() => void refineShownotesWithPrompt()}
              >
                {notesGenBusy ? "重写中…" : "开始重写"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
