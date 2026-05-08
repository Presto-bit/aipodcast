"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { useI18n } from "../../lib/I18nContext";

type Props = {
  projectId: string;
  getAuthHeaders: () => Record<string, string>;
  disabled: boolean;
  disabledReason?: string;
  label: string;
  busyLabel: string;
  hint: string;
  replaceWarn: string;
  onDone: () => void;
  onError: (msg: string) => void;
  hasMainAudio: boolean;
  /** bar：独立条带；inline：顶栏内紧凑；icon：仅上传图标按钮 */
  variant?: "bar" | "inline" | "icon";
  /** false 时仅允许单文件上传，不走路由合并 */
  allowMultiSegment?: boolean;
};

export default function PrestoFlowImportBar({
  projectId,
  getAuthHeaders,
  disabled,
  disabledReason,
  label,
  busyLabel,
  hint,
  replaceWarn,
  onDone,
  onError,
  hasMainAudio,
  variant = "bar",
  allowMultiSegment = true
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function runImport(files: FileList | null) {
    if (!files?.length || busy || disabled) return;
    if (!allowMultiSegment && files.length > 1) {
      onError(t("presto.flow.importSingleFileOnly"));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (hasMainAudio && files.length > 0 && !window.confirm(replaceWarn)) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    onError("");
    try {
      const list = Array.from(files);
      if (list.length === 1) {
        const f = list[0]!;
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": f.type || "application/octet-stream",
            "x-clip-filename": encodeClipFilenameForHttpHeader(f.name, "upload.mp3"),
            ...getAuthHeaders()
          },
          body: f
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `上传失败 ${res.status}`);
        }
      } else if (allowMultiSegment) {
        for (const f of list) {
          const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/stage`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": f.type || "application/octet-stream",
              "x-clip-filename": encodeClipFilenameForHttpHeader(f.name, "segment.mp3"),
              ...getAuthHeaders()
            },
            body: f
          });
          const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
          if (!res.ok || data.success === false) {
            throw new Error(data.detail || `暂存失败 ${res.status}`);
          }
        }
        const mergeRes = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/merge`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: "{}"
        });
        const mergeData = (await mergeRes.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!mergeRes.ok || mergeData.success === false) {
          throw new Error(mergeData.detail || `合并失败 ${mergeRes.status}`);
        }
      }
      onDone();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const hintText = disabled && disabledReason ? disabledReason : hint;
  const labelEl =
    variant === "icon" ? (
      <label
        className={[
          "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink shadow-soft transition",
          disabled || busy ? "pointer-events-none opacity-50" : "hover:bg-fill"
        ].join(" ")}
        title={hintText}
      >
        {busy ? (
          <span className="text-[10px] font-semibold text-muted">…</span>
        ) : (
          <Upload className="h-4 w-4" aria-hidden />
        )}
        <span className="sr-only">{busy ? busyLabel : label}</span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
          multiple={allowMultiSegment}
          disabled={disabled || busy}
          onChange={(e) => void runImport(e.target.files)}
        />
      </label>
    ) : (
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span
          title={variant === "inline" ? hintText : undefined}
          className={[
            "rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-soft",
            disabled || busy ? "pointer-events-none opacity-50" : "hover:bg-fill"
          ].join(" ")}
        >
          {busy ? busyLabel : label}
        </span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
          multiple={allowMultiSegment}
          disabled={disabled || busy}
          onChange={(e) => void runImport(e.target.files)}
        />
      </label>
    );

  if (variant === "inline" || variant === "icon") {
    return <div className="flex min-w-0 max-w-full items-center gap-2">{labelEl}</div>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-fill/25 px-3 py-2">
      {labelEl}
      <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted">{hintText}</p>
    </div>
  );
}
