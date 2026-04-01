"use client";

import { useEffect } from "react";
import { Button } from "./Button";

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
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <button
        type="button"
        className="absolute inset-0 bg-surface/50 backdrop-blur-[1px]"
        aria-label="关闭"
        disabled={busy}
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="fym-modal-card relative z-[1] w-full max-w-sm p-5">
        <h2 id="confirm-modal-title" className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{message}</p>
        {error ? (
          <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800" role="alert">
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
    </div>
  );
}
