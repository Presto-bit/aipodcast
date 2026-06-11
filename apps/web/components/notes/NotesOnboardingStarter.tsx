"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { apiErrorMessage } from "../../lib/apiError";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { ONBOARDING_STARTER_NOTEBOOK_NAME } from "../../lib/onboardingStarter";
import { useInvalidateNotebooksHub } from "../../lib/queries/notebooksQueries";
import { useNotebooksMetaQuery } from "../../lib/queries/notebooksMetaQueries";

type Props = {
  className?: string;
};

function totalNoteCount(stats: Record<string, { note_count?: number }> | undefined): number {
  if (!stats) return 0;
  return Object.values(stats).reduce((sum, row) => sum + Number(row?.note_count || 0), 0);
}

/**
 * 资料 Hub：无资料时引导一键创建示例笔记本。
 */
export default function NotesOnboardingStarter({ className = "" }: Props) {
  const { ready, user, getAuthHeaders } = useAuth();
  const loggedIn = isLoggedInAccountUser(user);
  const metaQuery = useNotebooksMetaQuery(getAuthHeaders, loggedIn && ready);
  const invalidateHub = useInvalidateNotebooksHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const show = useMemo(() => {
    if (!loggedIn || !ready || metaQuery.isLoading) return false;
    if (metaQuery.isError) return false;
    return totalNoteCount(metaQuery.data) === 0;
  }, [loggedIn, ready, metaQuery.data, metaQuery.isError, metaQuery.isLoading]);

  const createStarter = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notebooks/onboarding-starter", {
        method: "POST",
        credentials: "same-origin",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        notebook?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(apiErrorMessage(data, data.error || data.detail || "创建示例笔记本失败"));
      }
      invalidateHub();
      const nb = String(data.notebook || ONBOARDING_STARTER_NOTEBOOK_NAME);
      window.location.assign(`/notes/${encodeURIComponent(nb)}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders, invalidateHub]);

  if (!show) return null;

  return (
    <div
      className={[
        "rounded-2xl border border-brand/30 bg-brand/6 px-4 py-4 shadow-soft sm:px-5",
        className
      ].join(" ")}
    >
      <h3 className="text-sm font-semibold text-ink">第一次来？先试试示例资料</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        一键创建「{ONBOARDING_STARTER_NOTEBOOK_NAME}」笔记本，内含两条说明与可勾选示例。打开后即可向资料提问或生成短播客。
      </p>
      {error ? (
        <p className="mt-2 text-sm text-danger-ink" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
          disabled={busy}
          onClick={() => void createStarter()}
        >
          {busy ? "创建中…" : "一键创建示例笔记本"}
        </button>
        <Link href="/create" className="text-sm font-medium text-brand underline-offset-2 hover:underline">
          或直接开始生成播客
        </Link>
      </div>
    </div>
  );
}
