"use client";

import { ShowNotesMarkdownPreview } from "../podcast/ShowNotesMarkdownPreview";
import type { SharePublishHints } from "../../lib/sharePublishDefaults";

type Props = {
  notesTab: "preview" | "edit" | "ai";
  onNotesTab: (t: "preview" | "edit" | "ai") => void;
  showNotes: string;
  onShowNotesChange: (next: string) => void;
  onSaveShowNotes: () => void | Promise<void>;
  onOpenAiModal: () => void;
  hints: SharePublishHints;
  hasAudio: boolean;
  onSeekSeconds: (sec: number) => void;
  busy: boolean;
  shareAiBusy: boolean;
  showNotesSaveBusy: boolean;
  scriptResolvePending: boolean;
  hasOwner: boolean;
};

export function WorkHubShownotesSection({
  notesTab,
  onNotesTab,
  showNotes,
  onShowNotesChange,
  onSaveShowNotes,
  onOpenAiModal,
  hints,
  hasAudio,
  onSeekSeconds,
  busy,
  shareAiBusy,
  showNotesSaveBusy,
  scriptResolvePending,
  hasOwner
}: Props) {
  return (
    <section className="rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4">
      <h3 className="border-b border-line/60 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">Shownotes</h3>
      <div className="mt-3 space-y-3">
        <div className="flex gap-1 rounded-lg border border-line bg-fill/30 p-0.5">
          <button
            type="button"
            className={`min-h-[2rem] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              notesTab === "preview"
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:bg-fill/60 hover:text-ink"
            }`}
            onClick={() => onNotesTab("preview")}
          >
            预览
          </button>
          <button
            type="button"
            className={`min-h-[2rem] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              notesTab === "edit"
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:bg-fill/60 hover:text-ink"
            }`}
            onClick={() => onNotesTab("edit")}
          >
            编辑
          </button>
          <button
            type="button"
            className={`min-h-[2rem] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              notesTab === "ai"
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:bg-fill/60 hover:text-ink"
            }`}
            disabled={busy || shareAiBusy || scriptResolvePending}
            onClick={() => {
              onNotesTab("ai");
              onOpenAiModal();
            }}
          >
            AI优化
          </button>
        </div>
        {notesTab === "edit" ? (
          <p className="text-[11px] text-muted/90">
            Markdown；跳转 <code className="rounded bg-fill px-1">[3:20 标题](t:200)</code>
            {hasAudio ? "，预览可点。" : "。"}
          </p>
        ) : null}
        {notesTab === "edit" ? (
          <div className="relative">
            <button
              type="button"
              className="absolute right-2 top-2 z-10 rounded-md border border-line bg-surface/95 px-2.5 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur-sm hover:bg-fill disabled:opacity-40"
              disabled={busy || shareAiBusy || showNotesSaveBusy || !hasOwner}
              title={hasOwner ? "保存到作品并更新分享页" : "请先登录"}
              onClick={() => void onSaveShowNotes()}
            >
              {showNotesSaveBusy ? "保存中…" : "保存"}
            </button>
            <textarea
              className="w-full rounded-lg border border-line bg-fill/40 px-3 py-2.5 pr-[4.5rem] pt-10 font-mono text-sm leading-relaxed text-ink"
              rows={12}
              value={showNotes}
              onChange={(e) => onShowNotesChange(e.target.value)}
              disabled={busy || shareAiBusy || showNotesSaveBusy}
              maxLength={20_000}
            />
          </div>
        ) : (
          <div className="max-h-[min(70vh,28rem)] overflow-y-auto rounded-lg border border-line bg-fill/20 p-3">
            <ShowNotesMarkdownPreview
              markdown={showNotes}
              onSeekSeconds={onSeekSeconds}
              className="!max-h-none overflow-visible border-0 bg-transparent p-0"
            />
          </div>
        )}
        {hints.showNotesVeryShort ? (
          <p className="text-[11px] text-warning-ink">Shownotes 偏短。</p>
        ) : null}
      </div>
    </section>
  );
}
