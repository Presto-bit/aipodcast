"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";
import { NOTE_FILE_INPUT_ACCEPT } from "../../../lib/noteUploadConstants";
import { uploadNoteFileWithProgress } from "../../../lib/uploadNoteFile";

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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink">上传成稿资料</h2>
        <p className="mt-1 text-xs text-muted">与知识库笔记本上传相同，解析后纳入本 IP 成稿列表</p>
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
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line py-10 hover:border-brand/40 hover:bg-fill/30 disabled:opacity-50"
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
        {error ? <p className="mt-2 text-sm text-danger-ink">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            关闭
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
