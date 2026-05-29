"use client";

import type { Dispatch, SetStateAction } from "react";
import EmptyState from "../ui/EmptyState";
import { NotebookIcon } from "../icons";
import { notebookCoverImageUrl } from "../../lib/notebookCoverDisplay";
import {
  NOTEBOOK_CARD_THEMES,
  stableNotebookVisualFromName,
  type NotebookCardVisual
} from "../../lib/notebookCardThemes";
import type { NotebookCoverMeta, NotebookMeta, NotebookSharingRow, PopularNotebookItem } from "./notesNotebookTypes";

function formatNotebookCardMonthDay(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

type HubMineNotebookCardsProps = {
  notebooks: string[];
  notebookVisualByName: Record<string, NotebookCardVisual>;
  notebookMetaByName: Record<string, NotebookMeta>;
  notebookSharingByName: Record<string, NotebookSharingRow>;
  notebookCoverByName: Record<string, NotebookCoverMeta>;
  notebookCardMenu: string | null;
  setNotebookCardMenu: Dispatch<SetStateAction<string | null>>;
  onOpenNotebook: (nb: string) => void;
  onRequestNewNotebook: () => void;
  showNewTile: boolean;
  listClassName: string;
  onShareNotebook: (nb: string) => void;
  onRenameNotebook: (nb: string) => void;
  onDeleteNotebook: (nb: string) => void;
  onNotebookCoverSettings: (nb: string) => void;
};

export function HubMineNotebookCards({
  notebooks,
  notebookVisualByName,
  notebookMetaByName,
  notebookSharingByName,
  notebookCoverByName,
  notebookCardMenu,
  setNotebookCardMenu,
  onOpenNotebook,
  onRequestNewNotebook,
  showNewTile,
  listClassName,
  onShareNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onNotebookCoverSettings
}: HubMineNotebookCardsProps) {
  return (
    <div className={listClassName}>
      {showNewTile ? (
        <button
          type="button"
          onClick={onRequestNewNotebook}
          className="flex min-h-[170px] min-w-[188px] max-w-[240px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/40 bg-fill/50 text-muted hover:bg-fill"
        >
          <span className="text-5xl font-light leading-none text-brand">+</span>
          <span className="mt-2 text-sm font-medium text-brand">新建笔记本</span>
        </button>
      ) : null}
      {notebooks.map((nb) => {
        const picked = notebookVisualByName[nb];
        const visual = {
          theme: NOTEBOOK_CARD_THEMES[picked?.themeIndex ?? 0],
          iconIndex: picked?.iconIndex ?? 0
        };
        const meta = notebookMetaByName[nb];
        const cov = notebookCoverByName[nb];
        const coverImg = notebookCoverImageUrl(nb, cov, "mine");
        const hasCoverLayer = Boolean(coverImg);
        const shareRow = notebookSharingByName[nb];
        const sourceN = meta?.sourceCount ?? 0;
        const shareLabel = shareRow?.isPublic ? "已分享" : "未分享";
        const summaryLine = `${formatNotebookCardMonthDay(meta?.createdAt)}|参考资料:${sourceN}|${shareLabel}`;
        return (
          <div key={nb} className="flex min-w-[188px] max-w-[240px] shrink-0 flex-col">
            <div
              className={`relative flex min-h-[170px] min-w-[188px] max-w-[240px] flex-col overflow-hidden rounded-2xl border p-3 shadow-soft ${
                hasCoverLayer ? "border-line/80 bg-surface/95" : visual.theme.card
              }`}
            >
              {hasCoverLayer ? (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${coverImg})` }}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 z-[1] bg-gradient-to-b from-white/90 via-white/82 to-white/94"
                  />
                </>
              ) : null}
              <div className="absolute right-2 top-2 z-[4]">
                <span className="relative flex" data-notebook-card-overflow-menu>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-muted hover:bg-fill"
                    aria-label="更多"
                    aria-expanded={notebookCardMenu === nb}
                    onClick={() => setNotebookCardMenu((x) => (x === nb ? null : nb))}
                  >
                    ⋯
                  </button>
                  {notebookCardMenu === nb ? (
                    <div className="absolute right-0 top-full z-20 mt-0.5 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onRenameNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onNotebookCoverSettings(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        上传封面
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onShareNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        分享
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                        onClick={() => {
                          onDeleteNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </span>
              </div>
              <button
                type="button"
                className="relative z-[2] flex min-h-0 flex-1 flex-col justify-start gap-2 pr-6 text-left"
                onClick={() => onOpenNotebook(nb)}
              >
                {!hasCoverLayer ? (
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ${visual.theme.iconWrap}`}
                    aria-hidden
                  >
                    <NotebookIcon index={visual.iconIndex} width={20} height={20} />
                  </span>
                ) : null}
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-ink">{nb}</p>
                </div>
                <p className="relative z-[2] mt-auto shrink-0 line-clamp-3 break-all text-[10px] leading-snug text-muted">
                  {summaryLine}
                </p>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type HubPopularNotebookGridProps = {
  popularLoading: boolean;
  popularItems: PopularNotebookItem[];
  onPick: (item: PopularNotebookItem) => void;
  className?: string;
  showLoadMore?: boolean;
  popularHasMore?: boolean;
  popularLoadingMore?: boolean;
  onPopularLoadMore?: () => void;
};

export function HubPopularNotebookGrid({
  popularLoading,
  popularItems,
  onPick,
  className,
  showLoadMore,
  popularHasMore,
  popularLoadingMore,
  onPopularLoadMore
}: HubPopularNotebookGridProps) {
  return (
    <div className={className ?? ""}>
      {popularLoading ? <p className="py-8 text-center text-sm text-muted">加载中…</p> : null}
      {!popularLoading && popularItems.length === 0 ? (
        <EmptyState
          title="暂无热门分享"
          description="在分享中勾选「在热门笔记本中展示」，并保证至少 1 条参考资料且近一年有更新；满足门槛后按质量分排序。"
          className="mt-4 border-dashed border-line bg-fill/40 py-8"
        />
      ) : null}
      {!popularLoading ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {popularItems.map((item) => {
            const cov: NotebookCoverMeta = {
              coverMode: item.coverMode,
              coverPresetId: item.coverPresetId,
              hasUploadThumb: item.hasUploadThumb,
              autoCoverNoteId: item.autoCoverNoteId
            };
            const coverImg = notebookCoverImageUrl(item.notebook, cov, "popular", item.ownerUserId);
            const hasCoverLayer = Boolean(coverImg);
            const pv = stableNotebookVisualFromName(`${item.ownerUserId}:${item.notebook}`);
            const pvis = {
              theme: NOTEBOOK_CARD_THEMES[pv.themeIndex],
              iconIndex: pv.iconIndex
            };
            const sourceN = typeof item.sourceCount === "number" ? item.sourceCount : 0;
            const accessLabel = item.publicAccess === "edit" ? "可创作" : "只读";
            const summaryLine = `${formatNotebookCardMonthDay(item.latestSourceAt)}|参考资料:${sourceN}|${accessLabel}`;
            return (
              <div
                key={`${item.ownerUserId}:${item.notebook}`}
                className="flex min-w-[188px] max-w-[240px] shrink-0 flex-col"
              >
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className={`relative flex min-h-[170px] min-w-[188px] max-w-[240px] flex-col justify-start gap-2 overflow-hidden rounded-2xl border p-3 text-left shadow-soft transition-colors hover:border-brand/40 hover:bg-fill/40 ${
                    hasCoverLayer ? "border-line/80 bg-surface/95" : pvis.theme.card
                  }`}
                >
                  {hasCoverLayer ? (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${coverImg})` }}
                      />
                      <div
                        aria-hidden
                        className="absolute inset-0 z-[1] bg-gradient-to-b from-white/90 via-white/82 to-white/94"
                      />
                    </>
                  ) : null}
                  <div className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col pr-1">
                    {!hasCoverLayer ? (
                      <span
                        className={`mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-lg ${pvis.theme.iconWrap}`}
                        aria-hidden
                      >
                        <NotebookIcon index={pvis.iconIndex} width={22} height={22} />
                      </span>
                    ) : null}
                    <p className="line-clamp-2 text-xs font-semibold text-ink">{item.ownerDisplayName}</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{item.notebook}</p>
                  </div>
                  <p className="relative z-[2] mt-auto shrink-0 line-clamp-3 break-all pr-1 text-[10px] leading-snug text-muted">
                    {summaryLine}
                  </p>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {showLoadMore && !popularLoading && popularItems.length > 0 && popularHasMore ? (
        <div className="mt-4 flex justify-center pb-2">
          <button
            type="button"
            className="rounded-xl border border-line bg-fill/50 px-4 py-2 text-sm font-medium text-ink hover:bg-fill disabled:opacity-50"
            disabled={Boolean(popularLoadingMore)}
            onClick={() => onPopularLoadMore?.()}
          >
            {popularLoadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
