"use client";

import type { ReactNode } from "react";
import { IconSend } from "../home/HomeComposerShell";
import { voiceProgressLabel } from "../../lib/studioVoiceFromChat";
import type { StudioWork } from "../../lib/studioWorkTypes";

export default function StudioAgentComposer({
  work,
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  modeLabel,
  footerActions
}: {
  work: StudioWork;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  modeLabel?: string;
  footerActions?: ReactNode;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;
  const corpus =
    work.binding.notebook && work.binding.noteIds.length
      ? `@${work.binding.notebook}·${work.binding.noteIds.length}篇`
      : work.binding.notebook
        ? `@${work.binding.notebook}`
        : null;

  return (
    <div className="w-full">
      {footerActions ? <div className="mb-1.5 flex flex-wrap gap-1">{footerActions}</div> : null}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1 text-[10px] text-muted">
          {modeLabel ? (
            <span className="rounded bg-brand/10 px-1.5 py-0.5 font-medium text-brand">{modeLabel}</span>
          ) : null}
          <span>小红书</span>
          <span>{voiceProgressLabel(work.featureCore)}</span>
          {corpus ? <span className="truncate">{corpus}</span> : null}
          {work.brief.trim() ? (
            <span className="ml-auto max-w-[40%] truncate" title={work.brief}>
              Brief
            </span>
          ) : null}
        </div>
        <div className="relative px-2.5 py-1.5">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            rows={2}
            className="w-full min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent py-1 pr-9 text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted/80 disabled:opacity-50"
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
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-ink text-canvas disabled:opacity-30"
          >
            <span className="scale-[0.65]">
              <IconSend />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
