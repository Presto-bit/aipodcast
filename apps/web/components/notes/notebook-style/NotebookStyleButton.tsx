"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type NoteStyleMeta,
  type StyleSyncStatus
} from "../../../lib/notebookStyle";
import NotebookStyleModal from "./NotebookStyleModal";

type Props = {
  notebookName: string;
  selectedNoteIds: string[];
  noteMetas: NoteStyleMeta[];
  readOnly?: boolean;
  disabled?: boolean;
  onToast?: (message: string) => void;
  onError?: (message: string) => void;
  onItemChange?: (item: AuthorIpItem | null) => void;
};

function canLearnSelection(noteMetas: NoteStyleMeta[], selectedNoteIds: string[]): boolean {
  const selected = new Set(selectedNoteIds);
  return noteMetas.some((m) => {
    if (!selected.has(m.noteId)) return false;
    if ((m.bodyLength ?? 0) > 0) return true;
    return (m.ragChunkCount ?? 0) > 0;
  });
}

export default function NotebookStyleButton({
  notebookName,
  selectedNoteIds,
  noteMetas,
  readOnly = false,
  disabled = false,
  onToast,
  onError,
  onItemChange
}: Props) {
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const runLearn = async () => {
    if (!nb || selectedCount === 0 || !canLearn || readOnly) return;
    setBusy(true);
    setMenuOpen(false);
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
  };

  const btnDisabled =
    disabled || !nb || readOnly || selectedCount === 0 || !canLearn || loading || busy;

  if (!nb) return null;

  const showChip = syncStatus === "ready" || syncStatus === "outdated";

  if (showChip) {
    return (
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          disabled={disabled || readOnly || loading}
          className={
            syncStatus === "outdated"
              ? "inline-flex items-center gap-1 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm font-medium text-amber-900 dark:text-amber-100"
              : "inline-flex items-center gap-1 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2.5 text-sm font-medium text-brand"
          }
          onClick={() => setMenuOpen((v) => !v)}
        >
          {syncStatus === "outdated" ? `待更新 ▾` : `风格已就绪 ▾`}
        </button>
        {menuOpen ? (
          <div className="absolute left-0 top-full z-30 mt-1 min-w-[9rem] rounded-lg border border-line bg-surface py-1 shadow-card">
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-fill"
              onClick={() => {
                setMenuOpen(false);
                setModalOpen(true);
              }}
            >
              查看详情
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-fill disabled:opacity-50"
              disabled={btnDisabled}
              onClick={() => void runLearn()}
            >
              更新风格 ({selectedCount}条)
            </button>
          </div>
        ) : null}
        <NotebookStyleModal
          open={modalOpen}
          notebookName={nb}
          item={item}
          syncStatus={syncStatus}
          selectedCount={selectedCount}
          busy={busy}
          onClose={() => setModalOpen(false)}
          onLearn={() => void runLearn()}
          onItemUpdated={setItem}
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={btnDisabled}
        title={
          selectedCount === 0
            ? "请先勾选资料"
            : !canLearn
              ? "所选资料暂无可用正文"
              : indexingHint
        }
        className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-brand/35 bg-brand/8 px-3 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand/12 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => void runLearn()}
      >
        {busy ? "提炼中…" : "提炼写作风格"}
      </button>
      <NotebookStyleModal
        open={modalOpen}
        notebookName={nb}
        item={item}
        syncStatus={syncStatus}
        selectedCount={selectedCount}
        busy={busy}
        onClose={() => setModalOpen(false)}
        onLearn={() => void runLearn()}
        onItemUpdated={setItem}
      />
    </>
  );
}

export type { NoteStyleMeta as NotebookStyleNoteMeta };
