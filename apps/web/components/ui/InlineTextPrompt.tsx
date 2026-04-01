"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";

type Props = {
  open: boolean;
  title?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  className?: string;
  /** 为 false 时仅能通过按钮或 Escape 关闭（避免与同区域下拉等控件冲突） */
  closeOnOutsideClick?: boolean;
};

/**
 * 内联文本输入（无全屏遮罩）。点击组件外会触发 onCancel。
 */
export default function InlineTextPrompt({
  open,
  title,
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = "确定",
  cancelLabel = "取消",
  placeholder,
  className = "",
  closeOnOutsideClick = true
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnOutsideClick) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (wrapRef.current?.contains(t)) return;
      onCancel();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onCancel, closeOnOutsideClick]);

  if (!open) return null;

  return (
    <div
      ref={wrapRef}
      data-inline-text-prompt=""
      className={`fym-surface-card p-2.5 ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit();
        }
      }}
    >
      {title ? <p className="mb-1.5 text-xs font-medium text-ink">{title}</p> : null}
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="fym-control"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" className="px-2.5 py-1 text-xs" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" className="px-2.5 py-1 text-xs" onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
