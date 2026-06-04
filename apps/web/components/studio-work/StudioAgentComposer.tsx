"use client";

import { IconSend } from "../home/HomeComposerShell";

/** Cursor 风格输入：无顶栏状态条 */
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
    <div className="relative rounded-xl border border-line/90 bg-fill/30 px-3 py-2.5 shadow-sm">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={2}
        className="w-full min-h-[44px] max-h-[min(30vh,180px)] resize-none border-0 bg-transparent py-0.5 pr-10 text-[14px] leading-relaxed text-ink outline-none placeholder:text-muted/70 disabled:opacity-50"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <button
        type="button"
        title="发送"
        aria-label="发送"
        disabled={!canSend}
        onClick={onSend}
        className="absolute bottom-2.5 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-canvas transition hover:opacity-90 disabled:opacity-25"
      >
        <span className="scale-[0.7]">
          <IconSend />
        </span>
      </button>
    </div>
  );
}
