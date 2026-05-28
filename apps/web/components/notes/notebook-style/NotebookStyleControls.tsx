"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  ensureAuthorIpForNotebook,
  fetchAuthorIpByNotebook,
  learnAuthorIp,
  type AuthorIpItem
} from "../../../lib/authorIp";
import { syncPodcastCreativeFromAuthorIp } from "../../../lib/notebookPodcastStyle";
import {
  computeStyleSyncStatus,
  selectedNotesStyleFeaturesReady,
  styleSnapshotFromItem,
  type NoteStyleMeta,
  type StyleSyncStatus
} from "../../../lib/notebookStyle";
import NotebookStyleModal from "./NotebookStyleModal";

export type NotebookStyleControlsProps = {
  notebookName: string;
  selectedNoteIds: string[];
  noteMetas: NoteStyleMeta[];
  readOnly?: boolean;
  disabled?: boolean;
  onToast?: (message: string) => void;
  onError?: (message: string) => void;
  onItemChange?: (item: AuthorIpItem | null) => void;
  children: ReactNode;
};

type NotebookStyleContextValue = {
  notebookName: string;
  syncStatus: StyleSyncStatus;
  hasSnapshot: boolean;
  selectedCount: number;
  loading: boolean;
  busy: boolean;
  readOnly: boolean;
  disabled: boolean;
  learnDisabled: boolean;
  indexingHint?: string;
  runLearn: () => void;
  openModal: () => void;
};

const NotebookStyleContext = createContext<NotebookStyleContextValue | null>(null);

function useNotebookStyleContext(): NotebookStyleContextValue {
  const ctx = useContext(NotebookStyleContext);
  if (!ctx) {
    throw new Error("NotebookStyle 控件须在 NotebookStyleControls 内使用");
  }
  return ctx;
}

function canLearnSelection(noteMetas: NoteStyleMeta[], selectedNoteIds: string[]): boolean {
  const selected = new Set(selectedNoteIds);
  return noteMetas.some((m) => {
    if (!selected.has(m.noteId)) return false;
    if ((m.bodyLength ?? 0) > 0) return true;
    return (m.ragChunkCount ?? 0) > 0;
  });
}

/** 包裹参考资料区，供标题芯片（C）与勾选行主操作（B）共享状态 */
export function NotebookStyleControls({
  notebookName,
  selectedNoteIds,
  noteMetas,
  readOnly = false,
  disabled = false,
  onToast,
  onError,
  onItemChange,
  children
}: NotebookStyleControlsProps) {
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const nb = notebookName.trim();
  const selectedCount = selectedNoteIds.length;
  const canLearn = canLearnSelection(noteMetas, selectedNoteIds);
  const featuresReady = selectedNotesStyleFeaturesReady(noteMetas, selectedNoteIds);
  const indexingHint =
    selectedCount > 0 && canLearn && !featuresReady
      ? "部分资料仍在索引，提炼将先用摘要；索引完成后再次提炼可更快"
      : undefined;

  const syncStatus: StyleSyncStatus = useMemo(
    () => computeStyleSyncStatus(item, selectedNoteIds, noteMetas),
    [item, selectedNoteIds, noteMetas]
  );

  const hasSnapshot = Boolean(styleSnapshotFromItem(item)?.noteIds?.length);

  const load = useCallback(async () => {
    if (!nb) {
      setItem(null);
      return;
    }
    setLoading(true);
    try {
      const found = await fetchAuthorIpByNotebook(nb);
      setItem(found);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "加载风格失败");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [nb, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onItemChange?.(item);
  }, [item, onItemChange]);

  const runLearn = useCallback(async () => {
    if (!nb || selectedCount === 0 || !canLearn || readOnly) return;
    setBusy(true);
    try {
      let ip = item;
      if (!ip) {
        ip = await ensureAuthorIpForNotebook(nb);
      }
      const updated = await learnAuthorIp(ip.id, "full", selectedNoteIds);
      setItem(updated);
      syncPodcastCreativeFromAuthorIp(nb, updated);
      onToast?.("风格已更新，已用于播客、文章与自媒体");
      setModalOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "提炼失败";
      if (msg.includes("no_learning_materials")) {
        onError?.("所选资料暂无可用正文，请换选或等待解析完成");
      } else {
        onError?.(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [nb, selectedCount, canLearn, readOnly, item, selectedNoteIds, onToast, onError]);

  const learnDisabled =
    disabled || !nb || readOnly || selectedCount === 0 || !canLearn || loading || busy;

  const ctxValue: NotebookStyleContextValue = useMemo(
    () => ({
      notebookName: nb,
      syncStatus,
      hasSnapshot,
      selectedCount,
      loading,
      busy,
      readOnly,
      disabled,
      learnDisabled,
      indexingHint,
      runLearn: () => void runLearn(),
      openModal: () => setModalOpen(true)
    }),
    [
      nb,
      syncStatus,
      hasSnapshot,
      selectedCount,
      loading,
      busy,
      readOnly,
      disabled,
      learnDisabled,
      indexingHint,
      runLearn
    ]
  );

  if (!nb) return <>{children}</>;

  return (
    <NotebookStyleContext.Provider value={ctxValue}>
      {children}
      <NotebookStyleModal
        open={modalOpen}
        notebookName={nb}
        item={item}
        syncStatus={syncStatus}
        selectedCount={selectedCount}
        busy={busy}
        onClose={() => setModalOpen(false)}
        onLearn={() => void runLearn()}
        onItemUpdated={(updated) => {
          setItem(updated);
          syncPodcastCreativeFromAuthorIp(nb, updated);
        }}
      />
    </NotebookStyleContext.Provider>
  );
}

/** C：参考资料标题行 — 风格已就绪 / 待更新芯片 */
export function NotebookStyleHeaderChip() {
  const { syncStatus, loading, busy, readOnly, disabled, openModal } = useNotebookStyleContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (syncStatus === "none") return null;

  const isPending = syncStatus === "pending";
  const chipLabel = isPending ? "待更新" : "风格已就绪";
  const chipClass = isPending
    ? "border-warning/45 bg-warning-soft/80 text-warning-ink"
    : "border-brand/35 bg-brand/8 text-brand";

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        disabled={disabled || readOnly || loading}
        className={`inline-flex max-w-[7.5rem] items-center gap-0.5 truncate rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${chipClass}`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="truncate">{busy ? "更新中…" : chipLabel}</span>
        <span className="shrink-0 text-[9px] opacity-70" aria-hidden>
          ▾
        </span>
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[9.5rem] rounded-lg border border-line/80 bg-surface py-1 shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-fill"
            onClick={() => {
              setMenuOpen(false);
              openModal();
            }}
          >
            查看详情
          </button>
        </div>
      ) : null}
    </div>
  );
}

type NotebookStyleSourcesLearnHintProps = {
  showFirstLearnHint?: boolean;
  onDismissFirstLearnHint?: () => void;
};

/** 参考资料区：待更新 / 首次提炼提示（不含「更新风格 (N条)」计数文案） */
export function NotebookStyleSourcesLearnHint({
  showFirstLearnHint = false,
  onDismissFirstLearnHint
}: NotebookStyleSourcesLearnHintProps) {
  const {
    syncStatus,
    selectedCount,
    learnDisabled,
    busy,
    readOnly,
    indexingHint,
    runLearn
  } = useNotebookStyleContext();

  if (syncStatus === "ready" || readOnly) return null;
  if (syncStatus === "none" && !showFirstLearnHint) return null;

  const isPending = syncStatus === "pending";
  const actionLabel = busy ? "更新中…" : isPending ? "更新风格" : "提炼风格";

  return (
    <div
      id="notebook-style-learn-hint"
      className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
        isPending
          ? "border-warning/40 bg-warning-soft/70 text-warning-ink"
          : "border-brand/25 bg-brand/6 text-ink"
      }`}
      role="status"
    >
      <span className="min-w-0 flex-1">
        {isPending
          ? "所选资料有变化，可更新写作风格以用于对话、播客与文章"
          : "勾选资料后可提炼写作风格，用于对话、播客与文章"}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {syncStatus === "none" && onDismissFirstLearnHint ? (
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:text-ink"
            onClick={onDismissFirstLearnHint}
          >
            知道了
          </button>
        ) : null}
        <button
          type="button"
          disabled={learnDisabled}
          title={
            selectedCount === 0
              ? "请先勾选资料"
              : learnDisabled && !busy
                ? "所选资料暂无可用正文"
                : indexingHint
          }
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            isPending
              ? "border-warning/45 bg-surface/90 text-warning-ink hover:bg-surface"
              : "border-brand/35 bg-brand/10 text-brand hover:bg-brand/15"
          }`}
          onClick={() => runLearn()}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/** @deprecated 已由 NotebookStyleSourcesLearnHint 替代 */
export function NotebookStyleLearnAction() {
  return null;
}

export type { NoteStyleMeta as NotebookStyleNoteMeta };
