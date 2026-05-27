"use client";

import { useMemo, useState } from "react";
import AuthorIpCompactModal from "../author-ip/AuthorIpCompactModal";
import AuthorIpPositioningWizard from "../author-ip/AuthorIpPositioningWizard";
import type { AuthorIpItem, AuthorIpTrait } from "../../../lib/authorIp";
import { submitAuthorIpColdStart } from "../../../lib/authorIp";
import {
  buildStyleSummaryChips,
  buildStyleSummaryText,
  formatStyleLearnedAt,
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
  onClose,
  onLearn,
  onItemUpdated
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [positioningOpen, setPositioningOpen] = useState(false);
  const [positioningError, setPositioningError] = useState<string | null>(null);

  const summary = useMemo(() => buildStyleSummaryText(item), [item]);
  const chips = useMemo(() => buildStyleSummaryChips(item, 5), [item]);
  const learned = formatStyleLearnedAt(item);
  const traits = traitsFromItem(item);
  const recentChange = (item?.profile as { vitality?: { recentChange?: string } })?.vitality?.recentChange;

  const statusLabel =
    syncStatus === "none" ? "未生成" : syncStatus === "outdated" ? "待更新" : "已就绪";
  const statusDot =
    syncStatus === "ready" ? "bg-brand" : syncStatus === "outdated" ? "bg-amber-500" : "bg-line";

  const submitPositioning = async (payload: {
    whoAmI: string;
    audience: string;
    oneLiner: string;
    traits: AuthorIpTrait[];
  }) => {
    if (!item || !payload.oneLiner.trim()) {
      setPositioningError("请完成一句话定位");
      return;
    }
    setPositioningError(null);
    try {
      const updated = await submitAuthorIpColdStart(item.id, {
        whoAmI: payload.whoAmI.trim(),
        audience: payload.audience.trim(),
        oneLiner: payload.oneLiner.trim(),
        traits: payload.traits
      });
      onItemUpdated(updated);
      setPositioningOpen(false);
    } catch (e) {
      setPositioningError(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <>
      <AuthorIpCompactModal
        open={open && !positioningOpen}
        title={`写作风格 · ${notebookName}`}
        description="基于左侧已勾选资料提炼"
        maxWidthClass="max-w-md"
        busy={busy}
        onClose={onClose}
        footer={
          syncStatus !== "none" ? (
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              className="w-full rounded-dawn-md border border-brand/40 bg-brand/10 py-2 text-sm font-medium text-brand disabled:opacity-50"
              onClick={onLearn}
            >
              {syncStatus === "outdated" ? `更新风格 (${selectedCount}条)` : `重新提炼 (${selectedCount}条)`}
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
            <div className="space-y-2 rounded-lg border border-line/80 bg-fill/30 p-3 text-sm">
              {traits.length === 0 ? (
                <p className="text-xs text-muted">暂无特色条目</p>
              ) : (
                traits.slice(0, 8).map((t, i) => (
                  <div key={`${t.dimension}-${t.label}-${i}`}>
                    <span className="text-[10px] text-muted">{t.dimension || "语气"}</span>
                    <p className="font-medium text-ink">{t.label}</p>
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
          {!item?.isReadOnly ? (
            <button
              type="button"
              className="text-xs text-muted hover:text-brand"
              onClick={() => {
                setPositioningError(null);
                setPositioningOpen(true);
              }}
            >
              补充定位（可选）
            </button>
          ) : null}
        </div>
      </AuthorIpCompactModal>

      <AuthorIpCompactModal
        open={positioningOpen}
        title="补充定位"
        description="帮助系统理解你的写作方向"
        maxWidthClass="max-w-lg"
        busy={busy}
        onClose={() => !busy && setPositioningOpen(false)}
      >
        <AuthorIpPositioningWizard
          busy={busy}
          error={positioningError}
          showLater
          onSubmit={(p) => void submitPositioning(p)}
          onLater={() => setPositioningOpen(false)}
          onCancel={() => setPositioningOpen(false)}
        />
      </AuthorIpCompactModal>
    </>
  );
}
