"use client";

import type { ReactNode } from "react";
import { STUDIO_STATUS_PULSE, STUDIO_STATUS_TEXT } from "../../lib/studioVisualTokens";
import { IconStopSquare } from "../icons";
import { IconSend } from "../home/HomeComposerShell";

/** V2 命令栏：Ghost + Stop/Discard + 发送 */
export default function StudioAgentComposer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  ghost,
  footerLeft,
  footerRight,
  menuOpen = false,
  generating = false,
  onCancel,
  onDiscard
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  /** 命令栏 ghost（Editing… / Writing…） */
  ghost?: string;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  menuOpen?: boolean;
  generating?: boolean;
  onCancel?: () => void;
  onDiscard?: () => void;
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
      {ghost ? (
        <p className={`mb-1 flex items-center gap-2 px-0.5 ${STUDIO_STATUS_TEXT}`}>
          <span className={STUDIO_STATUS_PULSE} aria-hidden />
          {ghost}
        </p>
      ) : null}
      <div className="relative w-full overflow-visible">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="w-full min-h-[32px] max-h-[min(18vh,112px)] resize-none border-0 bg-transparent py-0.5 text-[14px] leading-relaxed text-ink outline-none ring-0 placeholder:text-muted/70 focus:outline-none focus:ring-0 disabled:opacity-50"
          style={{ paddingRight: hasText || generating ? (generating && onDiscard ? 88 : 44) : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && generating) {
              e.preventDefault();
              onDiscard?.() ?? onCancel?.();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {generating && (onCancel || onDiscard) ? (
          <div className="absolute bottom-0.5 right-0 flex items-center gap-0.5">
            {onDiscard ? (
              <button
                type="button"
                title="放弃（Esc）"
                aria-label="放弃"
                onClick={onDiscard}
                className="flex h-9 px-2 items-center justify-center rounded-full border border-line bg-surface text-[10px] text-muted transition hover:bg-fill hover:text-ink"
              >
                放弃
              </button>
            ) : null}
            {onCancel ? (
              <button
                type="button"
                title="停止（保留部分）"
                aria-label="停止"
                onClick={onCancel}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-fill"
              >
                <IconStopSquare width={16} height={16} aria-hidden />
              </button>
            ) : null}
          </div>
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
      {footerLeft || footerRight ? (
        <div
          className="relative mt-1.5 flex w-full items-center justify-between gap-2 overflow-visible"
          style={{ zIndex: menuOpen ? 10 : 1 }}
        >
          <div className="min-w-0 shrink">{footerLeft}</div>
          <div className="shrink-0">{footerRight}</div>
        </div>
      ) : null}
    </div>
  );
}
