"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { NOTE_FILE_INPUT_ACCEPT } from "../../../lib/noteUploadConstants";
import { uploadNoteFileWithProgress } from "../../../lib/uploadNoteFile";
import AuthorIpCompactModal from "./AuthorIpCompactModal";

type Props = {
  open: boolean;
  notebookName: string;
  busy?: boolean;
  onSuccess: () => void;
  onCancel: () => void;
};

export default function AuthorIpArticleUploadModal({ open, notebookName, busy: externalBusy, onSuccess, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = externalBusy || uploading;

  useEffect(() => {
    if (!open) {
      setProgress(null);
      setError(null);
    }
  }, [open]);

  const onFile = async (file: File | null) => {
    if (!file || !notebookName.trim()) return;
    setUploading(true);
    setError(null);
    setProgress(0);
    try {
      const res = await uploadNoteFileWithProgress(file, {
        notebook: notebookName.trim(),
        onProgress: (p) => setProgress(p)
      });
      if (!res.ok) throw new Error(res.error);
      if (res.data.success === false) {
        throw new Error(String(res.data.detail || "上传失败"));
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <AuthorIpCompactModal
      open={open}
      title="上传成稿资料"
      description="解析后学习你的写作风格"
      busy={busy}
      onClose={onCancel}
      maxWidthClass="max-w-sm"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
            关闭
          </Button>
        </div>
      }
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={NOTE_FILE_INPUT_ACCEPT}
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0] || null)}
      />
      <button
        type="button"
        disabled={busy || !notebookName.trim()}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line py-8 hover:border-brand/40 hover:bg-fill/30 disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
      >
        <span className="text-sm font-medium text-ink">{uploading ? "上传中…" : "选择文件"}</span>
        <span className="text-xs text-muted">PDF、Word、Markdown、TXT 等</span>
      </button>
      {progress !== null ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line/50">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-center text-xs text-muted">{progress < 100 ? `上传 ${progress}%` : "解析中…"}</p>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger-ink">{error}</p> : null}
    </AuthorIpCompactModal>
  );
}
