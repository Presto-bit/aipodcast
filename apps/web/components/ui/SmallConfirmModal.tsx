"use client";

import { Button } from "./Button";
import WorkspaceScrimModal from "./WorkspaceScrimModal";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** 请求失败时的简短错误文案 */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 轻量居中弹窗（遮罩 + 小卡片），用于删除等需二次确认的操作。
 */
export default function SmallConfirmModal({
  open,
  title,
  message,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger,
  busy,
  busyLabel = "处理中…",
  error,
  onConfirm,
  onCancel
}: Props) {
  return (
    <WorkspaceScrimModal open={open} onClose={onCancel} busy={busy} labelledBy="confirm-modal-title" scrimTone="40" className="p-3 sm:p-4">
      <div
        className="fym-modal-card relative z-[1] max-h-[min(88vh,42rem)] w-full max-w-[min(96vw,32rem)] overflow-y-auto p-4 sm:p-5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{message}</p>
        {error ? (
          <p className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-[11px] text-danger-ink" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            className="px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </WorkspaceScrimModal>
  );
}
