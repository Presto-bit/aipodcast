"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { ClipProjectRow } from "../../lib/clipTypes";
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
  onDone: () => void;
  /** 各次 stage 若返回 project，可合并进编辑器状态以减少全量 load */
  onProjectPatch?: (project: ClipProjectRow) => void;
  onError: (msg: string) => void;
  /** bar：独立条带；inline：顶栏内紧凑；icon：仅上传图标按钮 */
  variant?: "bar" | "inline" | "icon";
  /** false 时仅允许单文件上传；单文件与多文件均走分段暂存接口，由服务端合并 */
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
  onDone,
  onProjectPatch,
  onError,
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
    setBusy(true);
    onError("");
    try {
      const list = Array.from(files);
      const results = await Promise.all(
        list.map(async (f) => {
          const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/stage`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": f.type || "application/octet-stream",
              "x-clip-filename": encodeClipFilenameForHttpHeader(f.name || "segment.mp3", "segment.mp3"),
              ...getAuthHeaders()
            },
            body: f
          });
          const data = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            detail?: string;
            project?: ClipProjectRow;
          };
          if (!res.ok || data.success === false) {
            throw new Error(data.detail || `上传失败 ${res.status}`);
          }
          return data.project;
        })
      );
      const lastProject = results.filter(Boolean).pop() as ClipProjectRow | undefined;
      if (lastProject && onProjectPatch) onProjectPatch(lastProject);
      if (!lastProject || !onProjectPatch) onDone();
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
