"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import type { ClipProjectRow } from "../../lib/clipTypes";
import {
  CLIP_PROJECT_KIND_SHOWNOTES,
  clipProjectHasMaterial,
  isShownotesOnlyClipProject,
  shownotesProjectDisplayTitle
} from "../../lib/shownotesClipProject";
import SmallConfirmModal from "../ui/SmallConfirmModal";

const PAGE_SIZE = 10;

function formatCreatedAt(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(d);
}

export type ShownotesMyProjectsListProps = {
  refreshKey?: number;
  onOpenProject: (projectId: string, fileLabel: string) => void;
  /** 删除工程后通知父级（例如关闭当前打开的工作区） */
  onProjectDeleted?: (projectId: string) => void;
};

export default function ShownotesMyProjectsList({
  refreshKey = 0,
  onOpenProject,
  onProjectDeleted
}: ShownotesMyProjectsListProps) {
  const { getAuthHeaders } = useAuth();
  const { t, lang } = useI18n();
  const [items, setItems] = useState<ClipProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"single" | "batch" | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const locale = lang === "en" ? "en-US" : "zh-CN";
  const pageIds = useMemo(() => items.map((p) => p.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedOnPageCount = pageIds.filter((id) => selectedIds.has(id)).length;

  const loadPage = useCallback(
    async (pageIndex: number) => {
      setErr("");
      setLoading(true);
      try {
        const q = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageIndex * PAGE_SIZE),
          project_kind: CLIP_PROJECT_KIND_SHOWNOTES,
          sort: "created"
        });
        const res = await fetch(`/api/clip/projects?${q}`, {
          credentials: "same-origin",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          projects?: ClipProjectRow[];
          detail?: string;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `加载失败 ${res.status}`);
        }
        const raw = Array.isArray(data.projects) ? data.projects : [];
        const shownotes = raw.filter((p) => isShownotesOnlyClipProject(p) && clipProjectHasMaterial(p));
        setItems(shownotes);
        setHasNextPage(raw.length === PAGE_SIZE);
        setSelectedIds((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            if (shownotes.some((p) => p.id === id)) next.add(id);
          }
          return next;
        });
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e));
        setItems([]);
        setHasNextPage(false);
      } finally {
        setLoading(false);
      }
    },
    [getAuthHeaders]
  );

  useEffect(() => {
    void loadPage(page);
  }, [loadPage, page, refreshKey]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  async function saveRename(projectId: string) {
    const title = renameDraft.trim().slice(0, 200) || shownotesProjectDisplayTitle(items.find((p) => p.id === projectId) ?? null);
    setRenameBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string; error?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || data.error || `重命名失败 ${res.status}`);
      }
      setRenamingId(null);
      await loadPage(page);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRenameBusy(false);
    }
  }

  async function deleteProjectIds(ids: string[]) {
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(id)}/delete`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: "{}"
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `删除失败 ${res.status}`);
        }
        onProjectDeleted?.(id);
      }
      setDeleteMode(null);
      setDeleteTargetId(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      const remainingOnPage = items.length - ids.length;
      if (remainingOnPage <= 0 && page > 0) {
        setPage((p) => Math.max(0, p - 1));
      } else {
        await loadPage(page);
      }
    } catch (e) {
      setDeleteErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleteBusy(false);
    }
  }

  function openDeleteSingle(id: string) {
    setDeleteErr(null);
    setDeleteMode("single");
    setDeleteTargetId(id);
  }

  function openDeleteBatch() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleteErr(null);
    setDeleteMode("batch");
    setDeleteTargetId(null);
  }

  const deleteModalOpen = deleteMode !== null;
  const batchDeleteCount = deleteMode === "batch" ? selectedIds.size : 0;

  const showPager = page > 0 || hasNextPage;

  if (loading && items.length === 0 && page === 0) {
    return (
      <section className="mt-10 w-full max-w-3xl" aria-label="我的 Shownotes">
        <h2 className="text-sm font-semibold text-ink">我的 Shownotes</h2>
        <p className="mt-2 text-xs text-muted">加载中…</p>
      </section>
    );
  }

  if (!loading && items.length === 0 && page === 0) {
    return null;
  }

  return (
    <section className="mt-10 w-full max-w-3xl" aria-label="我的 Shownotes">
      <SmallConfirmModal
        open={deleteModalOpen}
        title={deleteMode === "batch" ? "批量删除工程" : t("clip.editor.deleteConfirmTitle")}
        message={
          deleteMode === "batch"
            ? `确定删除已选的 ${batchDeleteCount} 个 Shownotes 工程？删除后无法恢复。`
            : t("clip.editor.deleteConfirmMessage")
        }
        confirmLabel={t("clip.editor.deleteConfirm")}
        cancelLabel={t("clip.editor.deleteCancel")}
        danger
        busy={deleteBusy}
        busyLabel={t("clip.editor.deleting")}
        error={deleteErr}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteMode(null);
          setDeleteTargetId(null);
          setDeleteErr(null);
        }}
        onConfirm={() => {
          if (deleteMode === "batch") void deleteProjectIds([...selectedIds]);
          else if (deleteTargetId) void deleteProjectIds([deleteTargetId]);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">我的 Shownotes</h2>
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-2 text-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line accent-brand"
                checked={allPageSelected}
                disabled={loading || renameBusy || deleteBusy}
                onChange={toggleSelectAllPage}
              />
              全选本页
              {selectedOnPageCount > 0 ? `（${selectedOnPageCount}）` : null}
            </label>
            <button
              type="button"
              className="rounded-lg border border-danger/40 px-3 py-1.5 font-medium text-danger-ink transition hover:bg-danger-soft disabled:opacity-40"
              disabled={selectedIds.size === 0 || loading || deleteBusy || renameBusy}
              onClick={openDeleteBatch}
            >
              批量删除
              {selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="mt-2 text-xs text-danger-ink" role="alert">
          {err}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {items.map((p) => {
          const label = shownotesProjectDisplayTitle(p);
          const isRenaming = renamingId === p.id;
          return (
            <li key={p.id}>
              <div className="flex items-start gap-2 rounded-xl border border-line/80 bg-fill/25 p-3 transition hover:border-brand/25 hover:bg-fill/40">
                <input
                  type="checkbox"
                  className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-line accent-brand"
                  checked={selectedIds.has(p.id)}
                  disabled={loading || renameBusy || deleteBusy || isRenaming}
                  aria-label={`选择 ${label}`}
                  onChange={() => toggleSelect(p.id)}
                />
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameDraft}
                      maxLength={200}
                      disabled={renameBusy}
                      autoFocus
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveRename(p.id);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => {
                        if (!renameBusy) setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="block w-full truncate text-left text-sm font-medium text-ink hover:opacity-90"
                      onClick={() => onOpenProject(p.id, label)}
                    >
                      {label}
                    </button>
                  )}
                  <p className="mt-1 text-[10px] text-muted">{formatCreatedAt(p.created_at, locale)}</p>
                </div>
                {!isRenaming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded-lg border border-line bg-surface p-2 text-muted shadow-soft hover:bg-fill hover:text-ink"
                      aria-label={t("clip.hub.rename")}
                      disabled={loading || deleteBusy}
                      onClick={() => {
                        setRenameDraft(label);
                        setRenamingId(p.id);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-danger/40 bg-surface p-2 text-danger-ink shadow-soft hover:bg-danger-soft"
                      aria-label={t("clip.hub.deleteProject")}
                      disabled={loading || deleteBusy}
                      onClick={() => openDeleteSingle(p.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && items.length === 0 && page > 0 ? (
        <p className="mt-3 text-xs text-muted">本页暂无工程。</p>
      ) : null}

      {showPager ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 transition hover:bg-fill disabled:opacity-40"
            disabled={page <= 0 || loading}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
          >
            上一页
          </button>
          <span>第 {page + 1} 页</span>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 transition hover:bg-fill disabled:opacity-40"
            disabled={!hasNextPage || loading}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  );
}
