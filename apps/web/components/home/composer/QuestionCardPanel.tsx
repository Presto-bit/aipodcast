"use client";

import type { AssistantBlock, PlatformExpertId } from "../../../lib/homeComposerExpertTypes";
import { isIntakeStepComplete } from "../../../lib/composerExpertIntake";

type IntakeStepBlock = Extract<AssistantBlock, { kind: "intake_step" }>;

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export default function QuestionCardPanel({
  block,
  expertId,
  intake,
  disabled,
  onChange,
  onComplete,
  onSkip
}: {
  block: IntakeStepBlock;
  expertId: PlatformExpertId;
  intake: Record<string, string | string[]>;
  disabled?: boolean;
  onChange: (fieldId: string, value: string | string[], multi: boolean) => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const batchIndex = block.step - 1;
  const completedBatches = batchIndex;
  const batchComplete = isIntakeStepComplete(expertId, batchIndex, intake);
  const remainingFields = block.fields.filter((field) => {
    const raw = intake[field.fieldId];
    if (field.multi) {
      const selected = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return selected.filter(Boolean).length < (field.minSelect ?? 1);
    }
    return !raw;
  }).length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">等待确认{remainingFields > 0 ? `：还差 ${remainingFields} 项就能汇总需求` : "…"}</p>
      <p className="text-[11px] text-muted/80">等待您的回答…</p>

      <div className="rounded-2xl border border-line bg-surface shadow-soft">
        <div className="flex items-center justify-between border-b border-line/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none" aria-hidden>
              💬
            </span>
            <span className="text-sm font-medium text-ink">问题</span>
          </div>
          <span className="text-xs tabular-nums text-muted">
            {completedBatches} / {block.total}
          </span>
        </div>

        <div className="space-y-5 p-4">
          {block.fields.map((field, fieldIdx) => {
            const raw = intake[field.fieldId];
            const selected = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
            return (
              <div key={field.fieldId}>
                <p className="text-sm font-medium text-ink">
                  {fieldIdx + 1}. {field.prompt}
                </p>
                <div className="mt-2.5 flex flex-col gap-2">
                  {field.options.map((opt, optIdx) => {
                    const checked = selected.includes(opt.id);
                    const letter = optionLetter(optIdx);
                    return (
                      <label
                        key={opt.id}
                        className={[
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition",
                          checked
                            ? "border-brand bg-brand/8 text-ink ring-1 ring-brand/20"
                            : "border-line text-ink hover:border-brand/35 hover:bg-fill/40",
                          disabled ? "pointer-events-none opacity-60" : ""
                        ].join(" ")}
                      >
                        <input
                          type={field.multi ? "checkbox" : "radio"}
                          name={field.fieldId}
                          className="sr-only"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => {
                            if (field.multi) {
                              const next = checked ? selected.filter((x) => x !== opt.id) : [...selected, opt.id];
                              onChange(field.fieldId, next, true);
                            } else {
                              onChange(field.fieldId, opt.id, false);
                            }
                          }}
                        />
                        <span
                          className={[
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold",
                            checked ? "border-brand bg-brand text-brand-foreground" : "border-line text-muted"
                          ].join(" ")}
                        >
                          {letter}
                        </span>
                        <span className="leading-snug">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
                {field.hint ? <p className="mt-2 text-xs text-brand">💡 {field.hint}</p> : null}
              </div>
            );
          })}
        </div>

        {!disabled ? (
          <div className="flex items-center justify-end gap-3 border-t border-line/80 px-4 py-3">
            <button type="button" className="text-sm text-muted hover:text-ink" onClick={onSkip}>
              跳过
            </button>
            <button
              type="button"
              className={[
                "rounded-lg px-4 py-1.5 text-sm font-medium transition",
                batchComplete
                  ? "bg-brand text-brand-foreground hover:bg-brand/90"
                  : "cursor-not-allowed bg-fill text-muted"
              ].join(" ")}
              disabled={!batchComplete}
              onClick={onComplete}
            >
              完成 ↵
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
