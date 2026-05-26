"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { apiErrorMessage } from "../../../lib/apiError";
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

type Tab = "file" | "url";

export default function AuthorIpArticleUploadModal({
  open,
  notebookName,
  busy: externalBusy,
  onSuccess,
  onCancel
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("file");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const busy = externalBusy || uploading;

  useEffect(() => {
    if (!open) {
      setProgress(null);
      setError(null);
      setUrl("");
      setTab("file");
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

  const onUrlImport = async () => {
    const u = url.trim();
    const nb = notebookName.trim();
    if (!u) {
      setError("请输入有效的网页链接");
      return;
    }
    if (!nb) {
      setError("笔记本未就绪，请稍后重试");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/notes/import_url", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, notebook: nb })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: unknown;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(apiErrorMessage(data, "导入失败"));
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setUploading(false);
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
        <div className="flex justify-end gap-2">
          {tab === "url" ? (
            <Button
              type="button"
              className="px-2.5 py-1.5 text-xs"
              disabled={busy || !url.trim()}
              onClick={() => void onUrlImport()}
            >
              {uploading ? "导入中…" : "导入链接"}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex gap-1 rounded-lg bg-fill/50 p-0.5">
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${tab === "file" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          onClick={() => setTab("file")}
        >
          本地文件
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${tab === "url" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          onClick={() => setTab("url")}
        >
          网页链接
        </button>
      </div>

      {tab === "file" ? (
        <>
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
        </>
      ) : (
        <div className="space-y-2">
          <input
            type="url"
            className="w-full rounded-dawn-md border border-line bg-canvas px-2.5 py-2 text-sm"
            placeholder="https:// 文章或公众号链接"
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
          />
          <p className="text-[10px] text-muted">支持常见网页与公众号文章，导入后作为成稿参与风格学习</p>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-danger-ink">{error}</p> : null}
    </AuthorIpCompactModal>
  );
}
