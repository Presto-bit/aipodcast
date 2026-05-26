"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";

const EXPERIENCE_PRESETS = [
  { id: "who_am_i", label: "我是谁" },
  { id: "audience", label: "写给谁" },
  { id: "project", label: "项目经历" },
  { id: "", label: "空白" }
] as const;

type Mode = "experience" | "article";

type Props = {
  open: boolean;
  mode: Mode;
  title: string;
  body: string;
  templateId: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onTemplateId: (v: string) => void;
  busy?: boolean;
  error?: string | null;
  onSubmit: () => void;
  onCancel: () => void;
};

export default function AuthorIpMaterialFormModal({
  open,
  mode,
  title,
  body,
  templateId,
  onTitle,
  onBody,
  onTemplateId,
  busy,
  error,
  onSubmit,
  onCancel
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-5 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink">{mode === "experience" ? "添加经历" : "添加成稿"}</h2>
        {mode === "experience" ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXPERIENCE_PRESETS.map((p) => (
              <button
                key={p.id || "blank"}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  templateId === p.id ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"
                }`}
                onClick={() => {
                  onTemplateId(p.id);
                  if (p.label !== "空白" && !title) onTitle(p.label);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <input
          className="mt-3 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
          placeholder="标题"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
        />
        <textarea
          className="mt-2 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
          rows={6}
          placeholder="正文"
          value={body}
          onChange={(e) => onBody(e.target.value)}
        />
        {error ? <p className="mt-2 text-sm text-danger-ink">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={onSubmit}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
