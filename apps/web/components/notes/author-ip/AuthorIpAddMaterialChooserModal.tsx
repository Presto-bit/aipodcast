"use client";

import { FileText, IconUser } from "../../icons";
import AuthorIpCompactModal from "./AuthorIpCompactModal";

type Props = {
  open: boolean;
  onPickResume: () => void;
  onPickUpload: () => void;
  onCancel: () => void;
};

export default function AuthorIpAddMaterialChooserModal({ open, onPickResume, onPickUpload, onCancel }: Props) {
  return (
    <AuthorIpCompactModal open={open} title="添加素材" description="解析后学习你的写作风格" onClose={onCancel} maxWidthClass="max-w-sm">
      <div className="grid gap-2">
        <button
          type="button"
          className="flex items-start gap-3 rounded-xl border border-line bg-fill/30 p-3 text-left hover:border-brand/40 hover:bg-brand/5"
          onClick={onPickResume}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <IconUser width={18} height={18} aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">填写经历</span>
            <span className="mt-0.5 block text-xs text-muted">工作、教育等结构化背景</span>
          </span>
        </button>
        <button
          type="button"
          className="flex items-start gap-3 rounded-xl border border-line bg-fill/30 p-3 text-left hover:border-brand/40 hover:bg-brand/5"
          onClick={onPickUpload}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <FileText width={18} height={18} aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">上传成稿资料</span>
            <span className="mt-0.5 block text-xs text-muted">PDF / Word / 文本等</span>
          </span>
        </button>
      </div>
      <button type="button" className="mt-3 w-full text-center text-xs text-muted hover:text-ink" onClick={onCancel}>
        取消
      </button>
    </AuthorIpCompactModal>
  );
}
