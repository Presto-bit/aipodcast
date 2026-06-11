"use client";

import type { ReactNode } from "react";
import { IconStopSquare } from "../icons";
import { IconSend } from "../home/HomeComposerShell";

/** V2 命令栏：Stop + 发送（进度仅在画布展示） */
export default function StudioAgentComposer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  footerRight,
  menuOpen = false,
  generating = false,
  onCancel,
  onFocus,
  onBlur
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  footerRight?: ReactNode;
  menuOpen?: boolean;
  generating?: boolean;
  onCancel?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;

  return (
    <div
      className={[
        "relative w-full shrink-0 overflow-visible rounded-2xl border border-line bg-surface p-2 shadow-soft",
        menuOpen ? "z-40" : "z-20"
      ].join(" ")}
    >
      <div className="relative w-full overflow-visible">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="w-full min-h-[32px] max-h-[min(18vh,112px)] resize-none border-0 bg-transparent py-0.5 text-[14px] leading-relaxed text-ink outline-none ring-0 placeholder:text-muted/70 focus:outline-none focus:ring-0 disabled:opacity-50"
          style={{ paddingRight: hasText || generating ? 44 : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && generating && onCancel) {
              e.preventDefault();
              onCancel();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {generating && onCancel ? (
          <button
            type="button"
            title="暂停（Esc）"
            aria-label="暂停"
            onClick={onCancel}
            className="absolute bottom-0.5 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-fill"
          >
            <IconStopSquare width={16} height={16} aria-hidden />
          </button>
        ) : hasText ? (
          <button
            type="button"
            title="发送（Enter）"
            aria-label="发送"
            disabled={!canSend}
            onClick={onSend}
            className="absolute bottom-0.5 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-ink text-canvas transition hover:opacity-90 disabled:opacity-50"
          >
            <IconSend />
          </button>
        ) : null}
      </div>
      {footerRight ? (
        <div
          className="relative mt-1.5 flex w-full items-center justify-end gap-2 overflow-visible"
          style={{ zIndex: menuOpen ? 10 : 1 }}
        >
          <div className="shrink-0">{footerRight}</div>
        </div>
      ) : null}
    </div>
  );
}
