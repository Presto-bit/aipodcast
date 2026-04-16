"use client";

import { useRef, useState } from "react";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";

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
  hasMainAudio
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function runImport(files: FileList | null) {
    if (!files?.length || busy || disabled) return;
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
      } else {
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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-fill/25 px-3 py-2">
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span
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
          multiple
          disabled={disabled || busy}
          onChange={(e) => void runImport(e.target.files)}
        />
      </label>
      <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted">{disabled && disabledReason ? disabledReason : hint}</p>
    </div>
  );
}
