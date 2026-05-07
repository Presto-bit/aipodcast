"use client";

import { useCallback } from "react";

type Props = {
  manuscriptBody: string;
  scriptResolvePending: boolean;
  canEditScript: boolean;
  /** 口播稿编辑展开（与复制左侧「编辑 / 完成」联动） */
  scriptEditing?: boolean;
  onToggleScriptEditing?: () => void;
  showScriptEditToggle?: boolean;
  regenerateVoiceSupported: boolean;
  regenerateVoiceBusy: boolean;
  onRegenerateVoice?: () => void;
  onDeleteClick: () => void;
};

export function WorkHubScriptActions({
  manuscriptBody,
  scriptResolvePending,
  canEditScript,
  scriptEditing = false,
  onToggleScriptEditing,
  showScriptEditToggle = false,
  regenerateVoiceSupported,
  regenerateVoiceBusy,
  onRegenerateVoice,
  onDeleteClick
}: Props) {
  const copyAll = useCallback(async () => {
    const t = manuscriptBody.trim();
    if (!t) {
      window.alert("暂无可复制的正文。");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      window.alert("复制失败，请检查浏览器权限。");
    }
  }, [manuscriptBody]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {showScriptEditToggle && canEditScript ? (
        <button
          type="button"
          disabled={scriptResolvePending}
          onClick={() => onToggleScriptEditing?.()}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill disabled:opacity-40"
        >
          {scriptEditing ? "完成" : "编辑"}
        </button>
      ) : null}
      <button
        type="button"
        disabled={scriptResolvePending}
        onClick={() => void copyAll()}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill disabled:opacity-40"
      >
        复制
      </button>
      {regenerateVoiceSupported ? (
        <button
          type="button"
          disabled={
            regenerateVoiceBusy || scriptResolvePending || !manuscriptBody.trim() || !onRegenerateVoice
          }
          onClick={() => onRegenerateVoice?.()}
          className="rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/15 disabled:opacity-40"
        >
          {regenerateVoiceBusy ? "合成中…" : "重新合成语音"}
        </button>
      ) : null}
      {canEditScript ? (
        <button
          type="button"
          disabled={scriptResolvePending}
          onClick={onDeleteClick}
          className="rounded-lg border border-danger/35 bg-danger-soft/40 px-2 py-1 text-[11px] font-medium text-danger-ink hover:bg-danger-soft/70 disabled:opacity-40"
        >
          删除
        </button>
      ) : null}
    </div>
  );
}
