"use client";

import { GripVertical, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ClipAudioStagingEntry } from "../../lib/clipTypes";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { useI18n } from "../../lib/I18nContext";

type Props = {
  projectId: string;
  entries: readonly ClipAudioStagingEntry[];
  getAuthHeaders: () => Record<string, string>;
  disabled: boolean;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
};

export default function ClipStagingTracksBar({
  projectId,
  entries,
  getAuthHeaders,
  disabled,
  onRefresh,
  onError
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const order = useMemo(() => entries.map((e) => e.key), [entries]);

  const postReorder = useCallback(
    async (nextKeys: string[]) => {
      setBusy(true);
      onError("");
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/staging/reorder`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ staging_keys: nextKeys })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `重排失败 ${res.status}`);
        }
        await onRefresh();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
      }
    },
    [getAuthHeaders, onError, onRefresh, projectId]
  );

  const stageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || busy || disabled) return;
      setBusy(true);
      onError("");
      try {
        for (const f of Array.from(files)) {
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
        await onRefresh();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [busy, disabled, getAuthHeaders, onError, onRefresh, projectId]
  );

  const onDropOnIndex = useCallback(
    (targetIndex: number) => {
      if (!dragKey) return;
      const from = order.indexOf(dragKey);
      if (from < 0) return;
      const next = [...order];
      next.splice(from, 1);
      const insertAt = from < targetIndex ? targetIndex - 1 : targetIndex;
      next.splice(Math.max(0, insertAt), 0, dragKey);
      setDragKey(null);
      void postReorder(next);
    },
    [dragKey, order, postReorder]
  );

  if (entries.length === 0) return null;

  const byKey = new Map(entries.map((e) => [e.key, e] as const));

  return (
    <div className="mb-2 rounded-lg border border-line/80 bg-fill/25 px-2 py-1.5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-ink">{t("presto.flow.clipStaging.title")}</p>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm,.mp4,.mov"
            multiple
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => void stageFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={disabled || busy}
            title={t("presto.flow.clipStaging.addTip")}
            aria-label={t("presto.flow.clipStaging.addTip")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink shadow-soft hover:bg-fill disabled:opacity-40"
            onClick={() => inputRef.current?.click()}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <p className="mb-1.5 text-[9px] leading-snug text-muted">{t("presto.flow.clipStaging.hint")}</p>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {order.map((key, idx) => {
          const meta = byKey.get(key);
          const label = meta?.filename || key.slice(-24);
          return (
            <li
              key={key}
              draggable={!disabled && !busy}
              onDragStart={() => setDragKey(key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDropOnIndex(idx);
              }}
              className={[
                "flex min-h-0 items-center gap-1.5 rounded-md border border-line/60 bg-surface/80 px-1.5 py-1 text-[10px]",
                dragKey === key ? "opacity-70 ring-1 ring-brand/40" : ""
              ].join(" ")}
            >
              <span className="shrink-0 cursor-grab text-muted active:cursor-grabbing" title={t("presto.flow.clipStaging.dragTip")}>
                <GripVertical className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-ink" title={key}>
                {idx + 1}. {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
