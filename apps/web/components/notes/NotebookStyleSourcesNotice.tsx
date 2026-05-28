"use client";

import type { AuthorIpItem } from "../../lib/authorIp";
import { computeStyleSyncStatus, type NoteStyleMeta } from "../../lib/notebookStyle";

type Props = {
  item: AuthorIpItem | null;
  selectedNoteIds: string[];
  noteMetas: NoteStyleMeta[];
  showFirstLearnHint: boolean;
  onDismissFirstLearnHint: () => void;
  actionToast: string;
};

/** 参考资料区唯一持久提示条（outdated 由标题行「待更新」芯片承担，此处不再重复） */
export default function NotebookStyleSourcesNotice({
  item,
  selectedNoteIds,
  noteMetas,
  showFirstLearnHint,
  onDismissFirstLearnHint,
  actionToast
}: Props) {
  const syncStatus = computeStyleSyncStatus(item, selectedNoteIds, noteMetas);

  if (showFirstLearnHint && syncStatus === "none") {
    return (
      <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-brand/25 bg-brand/6 px-2.5 py-1.5 text-[11px] leading-snug text-ink">
        <span>勾选资料后可提炼写作风格，用于对话、播客与文章</span>
        <button
          type="button"
          className="shrink-0 text-[10px] text-muted hover:text-ink"
          onClick={onDismissFirstLearnHint}
        >
          知道了
        </button>
      </div>
    );
  }

  if (actionToast.trim()) {
    return (
      <p className="mt-2 text-[11px] font-medium text-brand" role="status">
        {actionToast}
      </p>
    );
  }

  return null;
}
