"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClipAudioStagingEntry, ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import { fetchClipProjectShareAiCopy } from "../../lib/api";
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
  /** 当前已合并主素材时长（毫秒），与文件名一并展示在素材列表首行 */
  mainAudioDurationMs: number | null;
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
  approxSegmentDurationMs,
  mainAudioDurationMs
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
                variant="icon"
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
              {hasServerAudio || entries.length > 0 ? (
                <ClipStagingTracksBar
                  projectId={projectId}
                  entries={entries}
                  getAuthHeaders={getAuthHeaders}
                  disabled={actionBusy || transcriptionActive || exportActive}
                  onRefresh={() => void load()}
                  onError={(msg) => setErr(msg)}
                  visualVariant="prd"
                  approxDurationMsPerSegment={approxSegmentDurationMs}
                  serverSource={
                    hasServerAudio
                      ? {
                          filename: String(project.audio_filename || "").trim() || "素材音频",
                          durationMs: mainAudioDurationMs
                        }
                      : null
                  }
                />
              ) : (
                <p className="text-[10px] leading-snug text-muted">请上传音频后开始转写。</p>
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
              rows={3}
              className="min-h-[2.5rem] flex-1 resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink placeholder:text-muted"
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
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              disabled={notesGenBusy}
              rows={14}
              className="min-h-[10rem] flex-1 resize-y rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-ink"
              placeholder="Shownotes 正文…"
            />
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
          </div>
        ) : null}
      </div>
    </aside>
  );
}
