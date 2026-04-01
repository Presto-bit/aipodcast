"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  className?: string;
  closeOnOutsideClick?: boolean;
  /** 提交中：禁用按钮并可在文案侧展示状态 */
  busy?: boolean;
  busyLabel?: string;
};

/**
 * 内联确认条（无全屏遮罩）。点击外部触发 onCancel。
 */
export default function InlineConfirmBar({
  open,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger,
  className = "",
  closeOnOutsideClick = true,
  busy,
  busyLabel = "处理中…"
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !closeOnOutsideClick || busy) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (wrapRef.current?.contains(t)) return;
      onCancel();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onCancel, closeOnOutsideClick, busy]);

  if (!open) return null;

  return (
    <div
      ref={wrapRef}
      data-inline-confirm=""
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-line bg-amber-50/90 px-2 py-1.5 text-[11px] ${className}`}
    >
      <span className="min-w-0 flex-1 text-ink">{message}</span>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 rounded px-2 py-0.5 text-muted hover:bg-white/80 disabled:opacity-50"
        onClick={onCancel}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        className={`shrink-0 rounded px-2 py-0.5 font-medium disabled:opacity-50 ${danger ? "text-rose-700 hover:bg-rose-100" : "text-brand hover:bg-fill"}`}
        onClick={onConfirm}
      >
        {busy ? busyLabel : confirmLabel}
      </button>
    </div>
  );
}
