"use client";

import { createPortal } from "react-dom";
import { FileText, IconUser } from "../../icons";

type Props = {
  open: boolean;
  onPickResume: () => void;
  onPickUpload: () => void;
  onCancel: () => void;
};

export default function AuthorIpAddMaterialChooserModal({ open, onPickResume, onPickUpload, onCancel }: Props) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-material-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-material-title" className="text-lg font-semibold text-ink">
          添加素材
        </h2>
        <p className="mt-1 text-xs text-muted">选择一种方式补充蒸馏原料</p>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className="flex items-start gap-3 rounded-xl border border-line bg-fill/30 p-3 text-left hover:border-brand/40 hover:bg-brand/5"
            onClick={onPickResume}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconUser width={20} height={20} aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">填写简历经历</span>
              <span className="mt-0.5 block text-xs text-muted">工作、教育、项目等结构化填写</span>
            </span>
          </button>
          <button
            type="button"
            className="flex items-start gap-3 rounded-xl border border-line bg-fill/30 p-3 text-left hover:border-brand/40 hover:bg-brand/5"
            onClick={onPickUpload}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <FileText width={20} height={20} aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">上传成稿资料</span>
              <span className="mt-0.5 block text-xs text-muted">与知识库相同，支持 PDF / Word / 文本等</span>
            </span>
          </button>
        </div>
        <button type="button" className="mt-4 w-full text-center text-sm text-muted hover:text-ink" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>,
    document.body
  );
}
