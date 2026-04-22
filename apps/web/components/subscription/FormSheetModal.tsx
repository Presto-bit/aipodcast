"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type FormSheetModalProps = {
  open: boolean;
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * 订阅/钱包类表单弹层：居中卡片、可点遮罩或 Esc 关闭（与 SmallConfirmModal 一致挂 body）。
 */
export default function FormSheetModal({ open, titleId, title, onClose, children }: FormSheetModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fym-workspace-scrim z-[1200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-surface/55 backdrop-blur-[1px]"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="fym-modal-card relative z-[1] flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-canvas shadow-lg sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-fill hover:text-ink"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
