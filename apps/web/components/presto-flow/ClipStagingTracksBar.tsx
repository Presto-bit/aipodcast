"use client";

import { GripVertical, Headphones, MoreHorizontal, Plus } from "../icons";
import { IconPause, IconPlayFilled } from "../icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { ClipAudioStagingEntry, ClipProjectRow } from "../../lib/clipTypes";
import { estimateDurationMsFromBytes } from "../../lib/clipSegmentDurationEstimate";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { useI18n } from "../../lib/I18nContext";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import SmallPromptModal from "../ui/SmallPromptModal";

function formatShortDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function basenameDecoded(objectKey: string): string {
  try {
    const last = objectKey.split("/").pop() || objectKey;
    return decodeURIComponent(last);
  } catch {
    return objectKey.slice(-96);
  }
}

/** 列表展示名：优先服务端 filename；否则解析 basename（stage_<16hex>_原始文件名） */
function labelForSegment(meta: ClipAudioStagingEntry | undefined, objectKey: string): string {
  const fn = meta?.filename?.trim();
  if (fn) return fn;
  try {
    const decoded = basenameDecoded(objectKey);
    const noExt = decoded.replace(/\.(mp3|wav|m4a|flac|aac|ogg|webm|mp4|mov)$/i, "").trim();
    const staged = /^stage_[a-f0-9]{16}_(.+)$/i.exec(noExt);
    if (staged?.[1]?.trim()) return staged[1].trim();
    if (noExt) return noExt;
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
  /** 重排/重命名/删除等接口若返回 project，可只合并状态而避免全量 load */
  onProjectPatch?: (project: ClipProjectRow) => void;
  onError: (msg: string) => void;
  /** PRD 素材列表 */
  visualVariant?: "default" | "prd";
  /** 无单段 size 时用于整轨均分估算 */
  approxDurationMsPerSegment?: number | null;
  /** 转写后各分段 object_key → 稿面真实时长（seg_key），优先于字节粗估 */
  durationMsBySegmentKey?: Readonly<Record<string, number>> | null;
  /** 转写成功且某段无 seg_key 时长时，用整稿均分而不是 128kbps 粗估，使列表合计接近播放器 */
  transcriptionSucceeded?: boolean;
  /** 无 entries、仅有合并源元数据时展示一行（旧数据）；有 entries 时不应再传 */
  serverSource?: { filename: string; durationMs: number | null; playbackUrl?: string } | null;
  /** 与 onSelectedTranscribeKeysChange 同时传入时：勾选状态由父组件控制（用于「只转勾选」） */
  selectedTranscribeKeys?: string[] | null;
  onSelectedTranscribeKeysChange?: (keys: string[]) => void;
};

export default function ClipStagingTracksBar({
  projectId,
  entries,
  getAuthHeaders,
  disabled,
  onRefresh,
  onProjectPatch,
  onError,
  visualVariant = "default",
  approxDurationMsPerSegment = null,
  durationMsBySegmentKey = null,
  transcriptionSucceeded = false,
  serverSource = null,
  selectedTranscribeKeys = null,
  onSelectedTranscribeKeysChange
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [playingHref, setPlayingHref] = useState<string | null>(null);
  const [checkedInternal, setCheckedInternal] = useState<Record<string, boolean>>({});
  const controlledSelection = selectedTranscribeKeys != null && typeof onSelectedTranscribeKeysChange === "function";
  const checked: Record<string, boolean> = controlledSelection
    ? Object.fromEntries((selectedTranscribeKeys ?? []).map((k) => [k, true]))
    : checkedInternal;
  const setCheckedOne = useCallback(
    (key: string, next: boolean) => {
      if (controlledSelection) {
        const cur = new Set(selectedTranscribeKeys ?? []);
        if (next) cur.add(key);
        else cur.delete(key);
        onSelectedTranscribeKeysChange!(Array.from(cur));
      } else {
        setCheckedInternal((c) => ({ ...c, [key]: next }));
      }
    },
    [controlledSelection, onSelectedTranscribeKeysChange, selectedTranscribeKeys]
  );
  const [menu, setMenu] = useState<{ key: string; top: number; right: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState<{ key: string; current: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

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

  const serverOrder = useMemo(() => entries.map((e) => e.key), [entries]);
  const serverOrderSigRef = useRef("");
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);

  useEffect(() => {
    const sig = serverOrder.join("\0");
    if (serverOrderSigRef.current !== sig) {
      serverOrderSigRef.current = sig;
      setPendingOrder(null);
    }
  }, [serverOrder]);

  const order = pendingOrder ?? serverOrder;

  useEffect(() => {
    if (controlledSelection) return;
    setCheckedInternal((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const k of order) {
        if (next[k] === undefined) next[k] = true;
      }
      for (const k of Object.keys(next)) {
        if (!order.includes(k)) delete next[k];
      }
      return next;
    });
  }, [controlledSelection, order]);

  useEffect(() => {
    const a = previewAudioRef.current;
    if (!a || !playingHref) {
      if (a && !playingHref) {
        a.pause();
        a.removeAttribute("src");
      }
      return;
    }
    a.src = playingHref;
    void a.play().catch(() => setPlayingHref(null));
  }, [playingHref]);

  const togglePreview = useCallback((href: string) => {
    setPlayingHref((cur) => {
      if (cur === href) {
        previewAudioRef.current?.pause();
        return null;
      }
      return href;
    });
  }, []);

  const postReorder = useCallback(
    async (nextKeys: string[]): Promise<boolean> => {
      setBusy(true);
      onError("");
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/staging/reorder`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ staging_keys: nextKeys })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          detail?: string;
          project?: ClipProjectRow;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `重排失败 ${res.status}`);
        }
        if (data.project && onProjectPatch) onProjectPatch(data.project);
        else await onRefresh();
        return true;
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [getAuthHeaders, onError, onProjectPatch, onRefresh, projectId]
  );

  const submitRename = useCallback(async () => {
    if (!renameOpen) return;
    const fn = renameDraft.trim();
    if (!fn || fn === renameOpen.current) {
      setRenameOpen(null);
      return;
    }
    setRenameBusy(true);
    onError("");
    try {
      const res = await fetch(
        `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/rename`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ object_key: renameOpen.key, filename: fn })
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: string;
        project?: ClipProjectRow;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `重命名失败 ${res.status}`);
      }
      setRenameOpen(null);
      if (data.project && onProjectPatch) onProjectPatch(data.project);
      else await onRefresh();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setRenameBusy(false);
    }
  }, [getAuthHeaders, onError, onProjectPatch, onRefresh, projectId, renameDraft, renameOpen]);

  const runRemove = useCallback(
    async (objectKey: string) => {
      setBusy(true);
      setRemoveBusy(true);
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
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          detail?: string;
          project?: ClipProjectRow;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `删除失败 ${res.status}`);
        }
        setMenu(null);
        setDeleteKey(null);
        if (data.project && onProjectPatch) onProjectPatch(data.project);
        else await onRefresh();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
        setRemoveBusy(false);
      }
    },
    [getAuthHeaders, onError, onProjectPatch, onRefresh, projectId]
  );

  const stageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || busy || disabled) return;
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
              throw new Error(data.detail || `暂存失败 ${res.status}`);
            }
            return data.project;
          })
        );
        const last = results.filter(Boolean).pop() as ClipProjectRow | undefined;
        if (last && onProjectPatch) onProjectPatch(last);
        if (!onProjectPatch) await onRefresh();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [busy, disabled, getAuthHeaders, onError, onProjectPatch, onRefresh, projectId]
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
      setPendingOrder(next);
      void postReorder(next).then((ok) => {
        if (!ok) setPendingOrder(null);
      });
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

  const rowDuration = (meta: ClipAudioStagingEntry | undefined, objectKey: string) => {
    const fromAsr = durationMsBySegmentKey?.[objectKey];
    if (typeof fromAsr === "number" && fromAsr > 0) return Math.round(fromAsr);
    if (transcriptionSucceeded && approxDurationMsPerSegment != null && approxDurationMsPerSegment > 0) {
      return approxDurationMsPerSegment;
    }
    const est = estimateDurationMsFromBytes(meta?.size_bytes);
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
                setRenameOpen({ key: menu.key, current: lab });
                setRenameDraft(lab);
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
                setDeleteKey(k);
              }}
            >
              删除
            </button>
          </div>,
          document.body
        )
      : null;

  const segmentPlaybackHref = (objectKey: string) =>
    `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/file?object_key=${encodeURIComponent(objectKey)}`;

  return (
    <div className={prd ? "min-w-0" : "mb-2 rounded-lg border border-line/80 bg-fill/25 px-2 py-1.5"}>
      <audio ref={previewAudioRef} className="hidden" preload="none" onEnded={() => setPlayingHref(null)} />
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
            {serverSource.playbackUrl ? (
              <button
                type="button"
                disabled={disabled || busy}
                title={playingHref === serverSource.playbackUrl ? "暂停" : "试听"}
                aria-label={playingHref === serverSource.playbackUrl ? "暂停试听" : "试听素材"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-fill disabled:opacity-40"
                onClick={() => togglePreview(serverSource.playbackUrl!)}
              >
                {playingHref === serverSource.playbackUrl ? (
                  <IconPause className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <IconPlayFilled className="h-3.5 w-3.5 translate-x-px" aria-hidden />
                )}
              </button>
            ) : null}
          </li>
        ) : null}
        {order.map((key, idx) => {
          const meta = byKey.get(key);
          const label = labelForSegment(meta, key);
          const durMs = rowDuration(meta, key);
          const playHref = segmentPlaybackHref(key);
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
                    onChange={() => setCheckedOne(key, !checked[key])}
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
                    disabled={disabled || busy}
                    title={playingHref === playHref ? "暂停" : "试听"}
                    aria-label={playingHref === playHref ? "暂停试听" : "试听该段素材"}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-fill disabled:opacity-40"
                    onClick={() => togglePreview(playHref)}
                  >
                    {playingHref === playHref ? (
                      <IconPause className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <IconPlayFilled className="h-3.5 w-3.5 translate-x-px" aria-hidden />
                    )}
                  </button>
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
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 rounded border-line accent-brand"
                    checked={Boolean(checked[key])}
                    onChange={() => setCheckedOne(key, !checked[key])}
                    aria-label={`选择 ${label}`}
                  />
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
      <SmallPromptModal
        open={Boolean(renameOpen)}
        title="重命名素材"
        value={renameDraft}
        onChange={setRenameDraft}
        placeholder="文件名"
        submitLabel="保存"
        busy={renameBusy}
        onSubmit={() => void submitRename()}
        onCancel={() => {
          if (!renameBusy) setRenameOpen(null);
        }}
      />
      <SmallConfirmModal
        open={Boolean(deleteKey)}
        title="删除素材"
        message="确定删除该段？若仍有多段素材，服务端会自动重新合并。"
        danger
        busy={removeBusy}
        confirmLabel="删除"
        onCancel={() => {
          if (!removeBusy) setDeleteKey(null);
        }}
        onConfirm={() => {
          if (deleteKey) void runRemove(deleteKey);
        }}
      />
    </div>
  );
}
