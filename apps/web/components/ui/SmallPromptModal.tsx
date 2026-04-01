"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";

type Props = {
  open: boolean;
  title: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
};

/**
 * 居中命名小弹窗：全屏半透明遮罩拦截点击（避免 pointer-events-none 穿透导致误触下层、或误判「外部点击」）。
 */
export default function SmallPromptModal({
  open,
  title,
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  submitLabel = "确定",
  cancelLabel = "取消",
  busy,
  error
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  useEffect(() => {
    if (!open) return;
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    function onTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const rootEl = cardRef.current;
      if (!rootEl) return;
      const nodes = Array.from(rootEl.querySelectorAll<HTMLElement>(sel)).filter((el) => !el.hasAttribute("disabled"));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    const root = cardRef.current;
    if (!root) return;
    root.addEventListener("keydown", onTab);
    return () => root.removeEventListener("keydown", onTab);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-modal-title"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div ref={cardRef} className="fym-modal-card w-full max-w-sm p-5" onPointerDown={(e) => e.stopPropagation()}>
        <h2 id="prompt-modal-title" className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="fym-control mt-3"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!busy) onSubmit();
            }
          }}
        />
        {error ? (
          <p className="mt-2 text-[11px] text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" disabled={busy} className="px-3 py-1.5 text-xs disabled:opacity-50" onClick={onSubmit}>
            {busy ? "处理中…" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
