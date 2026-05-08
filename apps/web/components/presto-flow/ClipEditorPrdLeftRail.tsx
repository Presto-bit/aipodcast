"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ClipAudioStagingEntry, ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import { fetchClipProjectShareAiCopy } from "../../lib/api";
import ClipStagingTracksBar from "./ClipStagingTracksBar";
import PrestoFlowImportBar from "./PrestoFlowImportBar";

type Tab = "materials" | "shownotes";

function shownotesStorageKey(projectId: string): string {
  return `clip-editor-prd-shownotes:${projectId}`;
}

type Props = {
  projectId: string;
  project: ClipProjectRow;
  getAuthHeaders: () => Record<string, string>;
  audioStagingEntries: readonly ClipAudioStagingEntry[];
  load: () => Promise<void>;
  onProjectPatch?: (project: ClipProjectRow) => void;
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
  /** 当前已合并主素材时长（毫秒） */
  mainAudioDurationMs: number | null;
};

export default function ClipEditorPrdLeftRail({
  projectId,
  project,
  getAuthHeaders,
  audioStagingEntries,
  load,
  onProjectPatch,
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

  /** 尚无分段元数据、仅有合并源时：在列表中展示为一行（与「分段列表」同一套 UI，不单独强调主轨） */
  const serverSourceRow =
    hasServerAudio && entries.length === 0
      ? {
          filename: String(project.audio_filename || "").trim() || "素材音频",
          durationMs: mainAudioDurationMs,
          playbackUrl: `/api/clip/projects/${encodeURIComponent(projectId)}/audio/file`
        }
      : null;

  return (
    <aside className="flex w-[min(22rem,44vw)] shrink-0 flex-col border-r border-line bg-surface/95 text-ink">
      <div className="flex items-center justify-between gap-1 border-b border-line px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {tabBtn("materials", "素材")}
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
              <div className="flex flex-wrap items-stretch gap-2">
                <PrestoFlowImportBar
                  variant="icon"
                  projectId={projectId}
                  getAuthHeaders={getAuthHeaders}
                  disabled={!loggedIn || actionBusy || transcriptionActive || exportActive}
                  label={t("presto.flow.importAudio")}
                  busyLabel={t("presto.flow.importBusy")}
                  hint={t("presto.flow.importHint")}
                  onDone={() => void load()}
                  onProjectPatch={onProjectPatch}
                  onError={(msg) => setErr(msg)}
                  allowMultiSegment={allowMultiSegmentImport}
                />
                <button
                  type="button"
                  disabled={transcribeDisabled}
                  onClick={onTranscribe}
                  title={transcribeLabel}
                  className="min-h-[2.25rem] min-w-0 flex-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground shadow-soft hover:opacity-95 disabled:opacity-40"
                >
                  {transcribeLabel}
                </button>
              </div>
              {hasServerAudio || entries.length > 0 ? (
                <ClipStagingTracksBar
                  projectId={projectId}
                  entries={entries}
                  getAuthHeaders={getAuthHeaders}
                  disabled={actionBusy || transcriptionActive || exportActive}
                  onRefresh={() => void load()}
                  onProjectPatch={onProjectPatch}
                  onError={(msg) => setErr(msg)}
                  visualVariant="prd"
                  approxDurationMsPerSegment={approxSegmentDurationMs}
                  serverSource={serverSourceRow}
                />
              ) : (
                <p className="text-[10px] leading-snug text-muted">请上传音频后开始转写。</p>
              )}
              {pendingInsertedSegments > 0 ? (
                <p className="text-[9px] text-muted">
                  含 {pendingInsertedSegments} 段新素材尚未转写；请点击「开始转写」后才会提交云端转写。
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "shownotes" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              disabled={notesGenBusy}
              rows={3}
              className="max-h-[4.5rem] min-h-[2.75rem] resize-y rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-ink"
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
