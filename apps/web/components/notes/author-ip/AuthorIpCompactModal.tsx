"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
  busy?: boolean;
  onClose: () => void;
};

/** 个人特色 IP：居中小范围弹窗（非全屏大卡） */
export default function AuthorIpCompactModal({
  open,
  title,
  description,
  children,
  footer,
  maxWidthClass = "max-w-md",
  busy,
  onClose
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fym-workspace-scrim z-[1200] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`fym-modal-card flex max-h-[min(88vh,720px)] w-full ${maxWidthClass} flex-col p-0`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
