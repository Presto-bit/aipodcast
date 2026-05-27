"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem, AuthorIpMaterial } from "../../../lib/authorIp";
import ClusterCloudChart from "./ClusterCloudChart";
import { buildDistillClusterCloud } from "./distillCenterCloud";
import {
  canUpdateAuthorIpStyle,
  domainsFromItem,
  formatLastLearnedAt,
  maturityLabel,
  positioningProgress,
  traitsFromItem,
  vitalityFromItem
} from "./utils";

type TabId = "summary" | "positioning" | "traits" | "scenes";

type Props = {
  open: boolean;
  item: AuthorIpItem;
  materials: AuthorIpMaterial[];
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onClose: () => void;
  onLearn: () => void;
  onEditPositioning: () => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "摘要" },
  { id: "positioning", label: "定位" },
  { id: "traits", label: "特色" },
  { id: "scenes", label: "场景" }
];

export default function AuthorIpStyleProfileDrawer({
  open,
  item,
  materials,
  counts,
  readOnly,
  busy,
  highlightTags,
  onClose,
  onLearn,
  onEditPositioning
}: Props) {
  const [tab, setTab] = useState<TabId>("summary");

  const clusters = useMemo(
    () => buildDistillClusterCloud(item, counts, highlightTags),
    [item, counts, highlightTags]
  );
  const canLearn = canUpdateAuthorIpStyle(item, materials);
  const traits = traitsFromItem(item);
  const domains = domainsFromItem(item);
  const v = vitalityFromItem(item);
  const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string } };
  const progress = positioningProgress(item);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1180] flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="风格档案">
      <button type="button" className="min-w-0 flex-1" aria-label="关闭" onClick={() => !busy && onClose()} />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-card">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">风格档案</h2>
          {!readOnly ? (
            <button
              type="button"
              title={canLearn ? "根据素材深度更新风格" : "请先添加参与学习的素材"}
              disabled={busy || !canLearn}
              className={
                canLearn
                  ? "ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                  : "ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-line px-2.5 py-1 text-xs text-muted disabled:opacity-50"
              }
              onClick={onLearn}
            >
              <IconRotateCw width={14} height={14} className={busy ? "animate-spin" : ""} aria-hidden />
              刷新风格
            </button>
          ) : null}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-fill"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={
                tab === t.id
                  ? "rounded-dawn-md bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                  : "rounded-dawn-md px-2.5 py-1 text-xs text-muted hover:bg-fill"
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "summary" ? (
            <div className="flex min-h-[280px] flex-col">
              <ClusterCloudChart
                clusters={clusters}
                centerTitle={item.displayName}
                maturityLabel={maturityLabel(String(item.maturity))}
              />
              {v?.recentChange ? (
                <p className="mt-3 text-xs text-muted">
                  <span className="font-medium text-ink">最近变像：</span>
                  {String(v.recentChange)}
                </p>
              ) : null}
              {formatLastLearnedAt(v?.lastLearnedAt) ? (
                <p className="mt-1 text-[10px] text-muted">学习于 {formatLastLearnedAt(v?.lastLearnedAt)}</p>
              ) : null}
            </div>
          ) : null}

          {tab === "positioning" ? (
            <div className="space-y-3 text-sm">
              {!readOnly ? (
                <button type="button" className="text-xs text-brand hover:underline" onClick={onEditPositioning}>
                  编辑定位
                </button>
              ) : null}
              <div>
                <p className="text-xs text-muted">一句话</p>
                <p className="mt-1 font-medium text-ink">{item.oneLiner || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">写什么</p>
                <p className="mt-1 text-ink">{(prof.coldStart?.whoAmI || "").trim() || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">写给谁</p>
                <p className="mt-1 text-ink">{(prof.coldStart?.audience || "").trim() || "—"}</p>
              </div>
              <p className="text-xs text-muted">完成度约 {progress.percent}%</p>
            </div>
          ) : null}

          {tab === "traits" ? (
            <div className="space-y-2">
              {traits.length === 0 ? (
                <p className="text-sm text-muted">暂无特色，添加成稿后点「刷新风格」。</p>
              ) : (
                traits.map((t, i) => (
                  <div
                    key={`${t.dimension}-${t.label}-${i}`}
                    className="rounded-lg border border-line/80 bg-canvas/50 px-3 py-2 text-sm"
                  >
                    <span className="text-xs text-muted">{t.dimension || "语气"}</span>
                    <p className="font-medium text-ink">{t.label}</p>
                    {t.evidence ? <p className="mt-1 text-xs text-muted">{t.evidence}</p> : null}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "scenes" ? (
            <div className="space-y-2">
              {domains.length === 0 ? (
                <p className="text-sm text-muted">暂无场景，刷新风格后根据成稿自动归纳。</p>
              ) : (
                domains.map((d, i) => (
                  <div key={i} className="rounded-lg border border-line/80 px-3 py-2">
                    <p className="font-medium text-ink">{d.displayName || "场景"}</p>
                    {d.boundArticleTitles?.length ? (
                      <p className="mt-1 text-xs text-muted">关联成稿：{d.boundArticleTitles.slice(0, 3).join("、")}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  );
}
