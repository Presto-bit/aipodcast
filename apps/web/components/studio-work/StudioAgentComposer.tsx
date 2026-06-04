"use client";

import type { ReactNode } from "react";
import { IconSend } from "../home/HomeComposerShell";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import type { StudioWork } from "../../lib/studioWorkTypes";

function ContextChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-[10rem] truncate rounded-md border border-line/80 bg-fill/40 px-2 py-0.5 text-[11px] text-muted"
    >
      {children}
    </span>
  );
}

export default function StudioAgentComposer({
  work,
  value,
  onChange,
  onSend,
  busy,
  disabled,
  placeholder,
  footerActions
}: {
  work: StudioWork;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  footerActions?: ReactNode;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !disabled;
  const noteCount = work.binding.noteIds.length;
  const corpusLabel = work.binding.notebook
    ? `@${work.binding.notebook}${noteCount ? ` · ${noteCount}篇` : ""}`
    : "@资料未绑";

  return (
    <div className="mx-auto w-full max-w-3xl">
      {footerActions ? <div className="mb-2 flex flex-wrap gap-1.5">{footerActions}</div> : null}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-soft ring-1 ring-line/50">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-3 py-2">
          <ContextChip title="渠道">小红书</ContextChip>
          <ContextChip title="左栏可改绑定">{corpusLabel}</ContextChip>
          <ContextChip title="左栏 Voice">
            Voice {isFeatureCoreComplete(work.featureCore) ? "✓" : "—"}
          </ContextChip>
          {work.brief.trim() ? (
            <ContextChip title={work.brief}>
              Brief · {work.brief.trim().slice(0, 24)}
              {work.brief.length > 24 ? "…" : ""}
            </ContextChip>
          ) : null}
        </div>
        <div className="relative px-3 pt-2 pb-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            rows={2}
            className="w-full min-h-[44px] max-h-[min(24vh,160px)] resize-y border-0 bg-transparent py-1.5 pr-10 text-[14px] leading-relaxed text-ink outline-none placeholder:text-muted/80 disabled:opacity-50"
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
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-canvas transition hover:opacity-90 disabled:opacity-30"
          >
            <span className="scale-75">
              <IconSend />
            </span>
          </button>
        </div>
        <p className="border-t border-line/50 px-3 py-1.5 text-[10px] text-muted">
          Enter 发送 · Shift+Enter 换行 · 澄清需求后写入 Brief，再生成计划
        </p>
      </div>
    </div>
  );
}
