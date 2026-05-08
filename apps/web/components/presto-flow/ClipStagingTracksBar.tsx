"use client";

import { GripVertical, Headphones, MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { ClipAudioStagingEntry } from "../../lib/clipTypes";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { useI18n } from "../../lib/I18nContext";

function formatShortDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** 无 ffprobe 时用字节粗估时长（约 128kbps），仅作列表展示 */
function estimateMsFromBytes(bytes?: number): number | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const bps = 128_000;
  return Math.round((bytes * 8 * 1000) / bps);
}

/** 列表展示名：优先服务端 filename，否则从 object key 路径解码 */
function labelForSegment(meta: ClipAudioStagingEntry | undefined, objectKey: string): string {
  const fn = meta?.filename?.trim();
  if (fn) return fn;
  try {
    const last = objectKey.split("/").pop() || objectKey;
    const decoded = decodeURIComponent(last);
    const noExt = decoded.replace(/\.(mp3|wav|m4a|flac|aac|ogg|webm|mp4|mov)$/i, "");
    const und = noExt.lastIndexOf("_");
    const base = und >= 0 ? noExt.slice(und + 1) : noExt;
    const out = base.trim();
    if (out) return out;
    return decoded.trim() || "未命名";
  } catch {
    return objectKey.slice(-48).trim() || "未命名";
  }
}

function PrdSourceMark() {
  return (
    <div
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand"
      aria-hidden
    >
      <Headphones className="h-3.5 w-3.5" />
    </div>
  );
}

type Props = {
  projectId: string;
  entries: readonly ClipAudioStagingEntry[];
  getAuthHeaders: () => Record<string, string>;
  disabled: boolean;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** PRD 素材列表 */
  visualVariant?: "default" | "prd";
  /** 无单段 size 时用于整轨均分估算 */
  approxDurationMsPerSegment?: number | null;
  /** 无 entries、仅有合并源元数据时展示一行（旧数据）；有 entries 时不应再传 */
  serverSource?: { filename: string; durationMs: number | null } | null;
};

export default function ClipStagingTracksBar({
  projectId,
  entries,
  getAuthHeaders,
  disabled,
  onRefresh,
  onError,
  visualVariant = "default",
  approxDurationMsPerSegment = null,
  serverSource = null
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ key: string; top: number; right: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-staging-menu-trigger]")) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

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

  const renameSegment = useCallback(
    async (objectKey: string, currentName: string) => {
      const next = window.prompt("重命名素材", currentName);
      if (next == null) return;
      const fn = next.trim();
      if (!fn || fn === currentName) return;
      setBusy(true);
      onError("");
      try {
        const res = await fetch(
          `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/rename`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ object_key: objectKey, filename: fn })
          }
        );
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `重命名失败 ${res.status}`);
        }
        setMenu(null);
        await onRefresh();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
      }
    },
    [getAuthHeaders, onError, onRefresh, projectId]
  );

  const removeSegment = useCallback(
    async (objectKey: string) => {
      if (!window.confirm("确定删除该段素材？删除后将重新合并主音频（若仍有多段）。")) return;
      setBusy(true);
      onError("");
      try {
        const res = await fetch(
          `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/remove`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ object_key: objectKey })
          }
        );
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `删除失败 ${res.status}`);
        }
        setMenu(null);
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

  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e] as const)), [entries]);

  const openStagingMenu = useCallback((key: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (menu?.key === key) {
      setMenu(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ key, top: r.bottom + 4, right: window.innerWidth - r.right });
  }, [menu?.key]);

  const prd = visualVariant === "prd";
  const hasServer = Boolean(serverSource?.filename?.trim());
  if (entries.length === 0 && !hasServer) return null;

  const rowDuration = (meta: ClipAudioStagingEntry | undefined) => {
    const est = estimateMsFromBytes(meta?.size_bytes);
    if (est != null && est > 0) return est;
    return approxDurationMsPerSegment;
  };

  const prdRowClass =
    "flex min-h-[2.75rem] min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-surface/90 px-2 py-2 text-[11px] leading-snug";

  const menuPanel =
    menu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: menu.top, right: menu.right, zIndex: 5500 }}
            className="min-w-[7.5rem] rounded-md border border-line bg-surface py-1 text-[11px] shadow-lg"
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-fill"
              onClick={() => {
                const meta = byKey.get(menu.key);
                const lab = labelForSegment(meta, menu.key);
                setMenu(null);
                void renameSegment(menu.key, lab);
              }}
            >
              重命名…
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-fill"
              onClick={() => {
                const k = menu.key;
                setMenu(null);
                void removeSegment(k);
              }}
            >
              删除
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={prd ? "min-w-0" : "mb-2 rounded-lg border border-line/80 bg-fill/25 px-2 py-1.5"}>
      {!prd ? (
        <>
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
        </>
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm,.mp4,.mov"
          multiple
          className="hidden"
          disabled={disabled || busy}
          onChange={(e) => void stageFiles(e.target.files)}
        />
      )}
      <ul
        className={
          prd
            ? "flex max-h-[min(24rem,55vh)] flex-col gap-1.5 overflow-y-auto"
            : "flex max-h-40 flex-col gap-1 overflow-y-auto"
        }
      >
        {prd && hasServer && serverSource && entries.length === 0 ? (
          <li className={prdRowClass}>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 shrink-0 rounded border-line accent-brand"
              disabled
              aria-label="选择"
            />
            <PrdSourceMark />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink" title={serverSource.filename}>
              {serverSource.filename}
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
              {formatShortDuration(serverSource.durationMs)}
            </span>
          </li>
        ) : null}
        {order.map((key, idx) => {
          const meta = byKey.get(key);
          const label = labelForSegment(meta, key);
          const durMs = rowDuration(meta);
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
                prdRowClass,
                dragKey === key ? "opacity-80 ring-1 ring-brand/35" : "",
                prd ? "" : "px-1.5 py-1 text-[10px]"
              ].join(" ")}
            >
              {prd ? (
                <>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 rounded border-line accent-brand"
                    checked={Boolean(checked[key])}
                    onChange={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                    aria-label={`选择 ${label}`}
                  />
                  <span
                    className="shrink-0 cursor-grab text-muted active:cursor-grabbing"
                    title={t("presto.flow.clipStaging.dragTip")}
                  >
                    <GripVertical className="h-4 w-4" aria-hidden />
                  </span>
                  <PrdSourceMark />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink" title={label}>
                    {label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
                    {formatShortDuration(durMs)}
                  </span>
                  <button
                    type="button"
                    data-staging-menu-trigger
                    disabled={disabled || busy}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-fill hover:text-ink disabled:opacity-40"
                    aria-label="更多"
                    title="更多"
                    onClick={(e) => openStagingMenu(key, e)}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                </>
              ) : (
                <>
                  <span
                    className="shrink-0 cursor-grab text-muted active:cursor-grabbing"
                    title={t("presto.flow.clipStaging.dragTip")}
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-ink" title={key}>
                    {`${idx + 1}. ${label}`}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {menuPanel}
    </div>
  );
}
