"use client";

import { useState } from "react";
import type { PlatformExpertId } from "../../../lib/homeComposerExpertTypes";
import { EXPERT_DISPLAY_NAMES } from "../../../lib/composerExperts";
import { intakeStepsForExpert } from "../../../lib/composerExpertIntake";

export default function ConfirmEditForm({
  expertId,
  taskSentence,
  intake,
  disabled,
  onSave,
  onCancel
}: {
  expertId: PlatformExpertId;
  taskSentence: string;
  intake: Record<string, string | string[]>;
  disabled?: boolean;
  onSave: (taskSentence: string, intake: Record<string, string | string[]>) => void;
  onCancel: () => void;
}) {
  const [task, setTask] = useState(taskSentence);
  const [draftIntake, setDraftIntake] = useState(intake);

  function setField(fieldId: string, value: string | string[], multi: boolean) {
    setDraftIntake((prev) => {
      const next = { ...prev };
      if (multi) {
        next[fieldId] = Array.isArray(value) ? value : [value];
      } else {
        next[fieldId] = Array.isArray(value) ? value[0] ?? "" : value;
      }
      return next;
    });
  }

  const steps = intakeStepsForExpert(expertId);

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-ink">编辑需求 · {EXPERT_DISPLAY_NAMES[expertId]}</p>
      <label className="block">
        <span className="text-xs font-medium text-ink">创作任务</span>
        <textarea
          rows={4}
          value={task}
          disabled={disabled}
          onChange={(e) => setTask(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/40"
        />
      </label>
      {steps.map((step) => (
        <div key={step.step} className="rounded-xl border border-line/80 bg-fill/10 p-3">
          <p className="text-xs font-medium text-muted">
            第 {step.step + 1}/{steps.length} 步 · {step.theme}
          </p>
          <div className="mt-3 space-y-3">
            {step.fields.map((field) => {
              const raw = draftIntake[field.fieldId];
              const selected = field.multi
                ? Array.isArray(raw)
                  ? raw
                  : raw
                    ? [String(raw)]
                    : []
                : [];
              const single = field.multi ? "" : String(raw ?? "");
              return (
                <div key={field.fieldId}>
                  <p className="text-sm font-medium text-ink">{field.prompt}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {field.options.map((opt) => {
                      const checked = field.multi ? selected.includes(opt.id) : single === opt.id;
                      return (
                        <label
                          key={opt.id}
                          className={[
                            "cursor-pointer rounded-full border px-3 py-1 text-xs transition",
                            checked ? "border-brand bg-brand/10 text-ink" : "border-line text-muted hover:border-brand/40",
                            disabled ? "pointer-events-none opacity-60" : ""
                          ].join(" ")}
                        >
                          <input
                            type={field.multi ? "checkbox" : "radio"}
                            name={`confirm-${field.fieldId}`}
                            className="sr-only"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => {
                              if (field.multi) {
                                const next = checked
                                  ? selected.filter((x) => x !== opt.id)
                                  : [...selected, opt.id];
                                setField(field.fieldId, next, true);
                              } else {
                                setField(field.fieldId, opt.id, false);
                              }
                            }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!disabled ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
            onClick={() => onSave(task.trim(), draftIntake)}
            disabled={!task.trim()}
          >
            保存并确认
          </button>
        </div>
      ) : null}
    </div>
  );
}
