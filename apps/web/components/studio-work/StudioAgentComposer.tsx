"use client";

import { IconSend } from "../home/HomeComposerShell";

/** 与 Home ComposerShell 一致的输入框样式 */
export default function StudioAgentComposer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;

  return (
    <div className="relative w-full shrink-0 overflow-visible rounded-2xl border border-line bg-surface p-3 shadow-soft">
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
    </div>
  );
}
