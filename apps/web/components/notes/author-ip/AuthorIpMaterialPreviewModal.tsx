"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";
import type { AuthorIpMaterial } from "../../../lib/authorIp";
import { tryParseResume, resumeToMarkdown } from "./resumeTypes";

type Props = {
  open: boolean;
  material: AuthorIpMaterial | null;
  readOnly?: boolean;
  onClose: () => void;
  onEditResume?: () => void;
  onLearningToggle?: (includeInStyleLearning: boolean) => void;
};

export default function AuthorIpMaterialPreviewModal({
  open,
  material,
  readOnly,
  onClose,
  onEditResume,
  onLearningToggle
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !material || typeof document === "undefined") return null;

  const resume = material.materialType === "experience_card" ? tryParseResume(material.body || "") : null;
  const displayBody = resume ? resumeToMarkdown(resume) : (material.body || material.preview || "").trim();
  const isResume = Boolean(resume);

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{material.title}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {isResume ? "简历经历" : material.materialType === "draft" ? "草稿" : "成稿资料"}
              {material.bodyLength ? ` · ${material.bodyLength} 字` : ""}
            </p>
          </div>
          <button type="button" className="text-xl text-muted hover:text-ink" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90">{displayBody || "（无正文）"}</pre>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          {onLearningToggle && !readOnly ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={material.includeInStyleLearning !== false}
                onChange={(e) => onLearningToggle(e.target.checked)}
              />
              参与文风学习（蒸馏）
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
          {isResume && onEditResume ? (
            <Button type="button" variant="secondary" onClick={onEditResume}>
              编辑简历
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            关闭
          </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
