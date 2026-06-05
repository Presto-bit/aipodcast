"use client";

import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import type { NotesAskSource } from "../../lib/notesAskCitation";

export default function StudioAskCitationModal({
  source,
  open,
  onClose
}: {
  source: NotesAskSource | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !source) return null;

  return (
    <WorkspaceScrimModal open labelledBy="studio-ask-source-title" scrimTone="45" onClose={onClose}>
      <div
        className="max-h-[min(80vh,560px)] w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line/80 px-4 py-3">
          <h2 id="studio-ask-source-title" className="text-sm font-semibold text-ink">
            引用摘录 [{source.index}] {source.title}
          </h2>
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-ink">
          {source.chunks?.length ? (
            <ul className="space-y-3">
              {source.chunks.map((c, i) => (
                <li key={`${c.chunkIndex}-${i}`} className="rounded-lg border border-line/70 bg-fill/40 p-2.5">
                  <p className="text-[11px] font-medium text-muted">块 {c.chunkIndex}</p>
                  <p className="mt-1.5 whitespace-pre-wrap">{c.excerpt || "（无摘录）"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">该来源暂无摘录预览，可在资料库打开原文。</p>
          )}
        </div>
        <div className="border-t border-line/80 px-4 py-2.5 text-right">
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-fill"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </WorkspaceScrimModal>
  );
}
