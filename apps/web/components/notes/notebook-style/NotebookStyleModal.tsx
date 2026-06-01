"use client";

import { useEffect, useMemo, useState } from "react";
import AuthorIpCompactModal from "../author-ip/AuthorIpCompactModal";
import { renameAuthorIpForNotebook, type AuthorIpItem } from "../../../lib/authorIp";
import {
  buildStyleSummaryChips,
  buildStyleSummaryText,
  formatStyleLearnedAt,
  groupStyleTraitsByDimension,
  type StyleSyncStatus
} from "../../../lib/notebookStyle";
import { traitsFromItem } from "../author-ip/utils";

type Props = {
  open: boolean;
  notebookName: string;
  item: AuthorIpItem | null;
  syncStatus: StyleSyncStatus;
  selectedCount: number;
  busy: boolean;
  loading?: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onLearn: () => void;
  onItemUpdated: (item: AuthorIpItem) => void;
};

export default function NotebookStyleModal({
  open,
  notebookName,
  item,
  syncStatus,
  selectedCount,
  busy,
  loading = false,
  readOnly = false,
  onClose,
  onLearn,
  onItemUpdated
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const styleTitle = (item?.displayName || notebookName).trim() || notebookName;
  const summary = useMemo(() => buildStyleSummaryText(item), [item]);
  const chips = useMemo(() => buildStyleSummaryChips(item, 8), [item]);
  const learned = formatStyleLearnedAt(item);
  const traitGroups = useMemo(() => groupStyleTraitsByDimension(traitsFromItem(item)), [item]);
  const recentChange = (item?.profile as { vitality?: { recentChange?: string } })?.vitality?.recentChange;

  const statusLabel =
    syncStatus === "none" ? "未生成" : syncStatus === "pending" ? "待提炼" : "已就绪";
  const statusDot =
    syncStatus === "ready" ? "bg-brand" : syncStatus === "pending" ? "bg-amber-500" : "bg-line";

  useEffect(() => {
    if (!open) {
      setRenaming(false);
      setRenameError(null);
    }
  }, [open]);

  useEffect(() => {
    setRenaming(false);
    setRenameError(null);
  }, [notebookName]);

  useEffect(() => {
    if (!open || renaming) return;
    setRenameDraft(styleTitle);
  }, [styleTitle, open, renaming]);

  const renameBlocked = readOnly || Boolean(item?.isReadOnly);
  const renameDisabled = busy || loading || renameSaving;
  const currentDisplayName = (item?.displayName || notebookName).trim() || notebookName;

  const submitRename = async () => {
    if (renameBlocked) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenameError("名称不能为空");
      return;
    }
    if (name === currentDisplayName) {
      setRenaming(false);
      setRenameError(null);
      return;
    }
    setRenameError(null);
    setRenameSaving(true);
    try {
      const updated = await renameAuthorIpForNotebook(notebookName.trim(), name);
      onItemUpdated(updated);
      setRenaming(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRenameSaving(false);
    }
  };

  const footerLearnLabel =
    syncStatus === "ready"
      ? `重新生成 (${selectedCount}条)`
      : `提炼写作风格 (${selectedCount}条)`;

  const showFooterLearn = syncStatus === "ready" || syncStatus === "pending";

  return (
    <AuthorIpCompactModal
      open={open}
      title={`写作风格 · ${notebookName}`}
      description="基于左侧已勾选资料提炼"
      maxWidthClass="max-w-md"
      busy={busy}
      onClose={onClose}
      footer={
        showFooterLearn ? (
          <button
            type="button"
            disabled={busy || selectedCount === 0}
            className="w-full rounded-dawn-md border border-brand/40 bg-brand/10 py-2 text-sm font-medium text-brand disabled:opacity-50"
            onClick={onLearn}
          >
            {footerLearnLabel}
          </button>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden />
            {statusLabel}
          </span>
          <span>已选 {selectedCount} 条</span>
          {learned ? <span>更新于 {learned}</span> : null}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-2">
          {renaming && !renameBlocked ? (
            <div className="min-w-0 flex-1">
              <input
                type="text"
                className="w-full rounded-lg border border-line bg-fill px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                value={renameDraft}
                maxLength={120}
                disabled={renameDisabled}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitRename();
                  if (e.key === "Escape") {
                    setRenaming(false);
                    setRenameDraft(currentDisplayName);
                    setRenameError(null);
                  }
                }}
              />
              {renameError ? <p className="mt-1 text-[11px] text-danger-ink">{renameError}</p> : null}
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                  disabled={renameDisabled}
                  onClick={() => void submitRename()}
                >
                  {renameSaving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink"
                  disabled={renameDisabled}
                  onClick={() => {
                    setRenaming(false);
                    setRenameDraft(currentDisplayName);
                    setRenameError(null);
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{styleTitle}</p>
              {!renameBlocked ? (
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted hover:text-brand disabled:opacity-50"
                  disabled={renameDisabled}
                  onClick={() => {
                    setRenameDraft(currentDisplayName);
                    setRenaming(true);
                  }}
                >
                  改名
                </button>
              ) : null}
            </>
          )}
        </div>

        <p className="text-sm leading-relaxed text-ink">{summary}</p>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c}
                className="rounded-md border border-line/80 bg-canvas/80 px-2 py-0.5 text-[11px] font-medium text-ink"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-[11px] text-muted">已选 {selectedCount} 条资料（与左侧勾选一致）</p>
        <button
          type="button"
          className="text-xs text-brand hover:underline"
          onClick={() => setDetailOpen((v) => !v)}
        >
          {detailOpen ? "收起详情" : "查看详情"}
        </button>
        {detailOpen ? (
          <div className="space-y-3 rounded-lg border border-line/80 bg-fill/30 p-3 text-sm">
            {traitGroups.length === 0 ? (
              <p className="text-xs text-muted">暂无特色条目</p>
            ) : (
              traitGroups.map((group) => (
                <div key={group.dimension}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{group.dimension}</p>
                  <ul className="mt-1 space-y-1">
                    {group.items.map((t, i) => (
                      <li key={`${group.dimension}-${t.label}-${i}`} className="text-xs leading-snug">
                        <span className="font-medium text-ink">{t.label}</span>
                        {t.evidence ? (
                          <span className="mt-0.5 block text-[10px] text-muted line-clamp-2">{t.evidence}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {recentChange ? (
              <p className="text-xs text-muted">
                <span className="text-ink">最近变像：</span>
                {String(recentChange)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </AuthorIpCompactModal>
  );
}
