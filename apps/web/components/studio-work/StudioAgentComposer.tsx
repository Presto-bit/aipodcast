"use client";

import type { ReactNode } from "react";
import { IconSend } from "../home/HomeComposerShell";

/** 与 Home ComposerShell 一致的输入框；资料等控件在框内右下 */
export default function StudioAgentComposer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  footerRight,
  menuOpen = false
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  footerRight?: ReactNode;
  menuOpen?: boolean;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;

  return (
    <div
      className={[
        "relative w-full shrink-0 overflow-visible rounded-2xl border border-line bg-surface p-3 shadow-soft",
        menuOpen ? "z-40" : "z-20"
      ].join(" ")}
    >
      <div className="relative w-full overflow-visible">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={2}
          className="w-full min-h-[56px] max-h-[min(32vh,200px)] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed text-ink outline-none ring-0 placeholder:text-muted/70 focus:outline-none focus:ring-0 disabled:opacity-50"
          style={{ paddingRight: hasText ? 60 : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {hasText ? (
          <button
            type="button"
            title="发送"
            aria-label="发送"
            disabled={!canSend}
            onClick={onSend}
            className="absolute bottom-1 right-0 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-canvas transition hover:opacity-90 disabled:opacity-50"
          >
            <IconSend />
          </button>
        ) : null}
      </div>
      {footerRight ? (
        <div
          className="relative mt-2 flex w-full items-center justify-end overflow-visible pt-0.5"
          style={{ zIndex: menuOpen ? 10 : 1 }}
        >
          {footerRight}
        </div>
      ) : null}
    </div>
  );
}
