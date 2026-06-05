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
  menuOpen = false,
  generating = false,
  onCancel,
  hasPendingPatch = false,
  onAcceptPatch,
  onUndoPatch
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
  hasPendingPatch?: boolean;
  onAcceptPatch?: () => void;
  onUndoPatch?: () => void;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;
  const showHints = generating || hasPendingPatch || Boolean(onUndoPatch);

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
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="w-full min-h-[32px] max-h-[min(18vh,112px)] resize-none border-0 bg-transparent py-0.5 text-[14px] leading-relaxed text-ink outline-none ring-0 placeholder:text-muted/70 focus:outline-none focus:ring-0 disabled:opacity-50"
          style={{ paddingRight: hasText ? 44 : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && generating && onCancel) {
              e.preventDefault();
              onCancel();
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hasPendingPatch && onAcceptPatch) {
              e.preventDefault();
              onAcceptPatch();
              return;
            }
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
            className="absolute bottom-0.5 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-ink text-canvas transition hover:opacity-90 disabled:opacity-50"
          >
            <IconSend />
          </button>
        ) : null}
      </div>
      {showHints ? (
        <p className="mt-1 px-0.5 text-[10px] text-muted">
          {generating ? "Esc 停止生成" : null}
          {hasPendingPatch ? " · ⌘↵ 接受改版" : null}
          {onUndoPatch ? (
            <>
              {" · "}
              <button type="button" className="text-brand underline" onClick={onUndoPatch}>
                撤销
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {footerRight ? (
        <div
          className="relative mt-1.5 flex w-full items-center justify-end overflow-visible"
          style={{ zIndex: menuOpen ? 10 : 1 }}
        >
          {footerRight}
        </div>
      ) : null}
    </div>
  );
}
