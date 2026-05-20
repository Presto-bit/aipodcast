"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import type { ClipProjectRow } from "../../lib/clipTypes";
import {
  CLIP_PROJECT_KIND_SHOWNOTES,
  clipProjectHasMaterial,
  isShownotesOnlyClipProject,
  shownotesProjectDisplayTitle
} from "../../lib/shownotesClipProject";

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
};

export default function ShownotesMyProjectsList({ refreshKey = 0, onOpenProject }: ShownotesMyProjectsListProps) {
  const { getAuthHeaders } = useAuth();
  const { lang } = useI18n();
  const [items, setItems] = useState<ClipProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const locale = lang === "en" ? "en-US" : "zh-CN";

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
      <h2 className="text-sm font-semibold text-ink">我的 Shownotes</h2>
      {err ? (
        <p className="mt-2 text-xs text-danger-ink" role="alert">
          {err}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {items.map((p) => {
          const label = shownotesProjectDisplayTitle(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-line/80 bg-fill/25 px-4 py-3 text-left text-sm transition hover:border-brand/35 hover:bg-fill/45"
                onClick={() => onOpenProject(p.id, label)}
              >
                <span className="min-w-0 truncate font-medium text-ink">{label}</span>
                <span className="shrink-0 text-xs text-muted">{formatCreatedAt(p.created_at, locale)}</span>
              </button>
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
