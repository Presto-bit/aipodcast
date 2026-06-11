"use client";

import Link from "next/link";
import {
  WORKBENCH_HOME_PATH,
  WORKBENCH_PODCAST_SHOWNOTES_PATH,
  podcastShownotesMakeHref
} from "../../lib/navPaths";
import { useCallback, useEffect, useState } from "react";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import type { ClipProjectRow } from "../../lib/clipTypes";
import {
  clipProjectHasMaterial,
  isShownotesOnlyClipProject,
  shownotesProjectDisplayTitle
} from "../../lib/shownotesClipProject";

export default function ShownotesMakeHubClient() {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [items, setItems] = useState<ClipProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const q = new URLSearchParams({ limit: "80", project_kind: "shownotes", sort: "created" });
      const res = await fetch(`/api/clip/projects?${q}`, { credentials: "same-origin", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; projects?: ClipProjectRow[]; detail?: string };
      if (!res.ok || data.success === false) throw new Error(data.detail || `加载失败 ${res.status}`);
      setItems(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false);
      return;
    }
    void load();
  }, [isLoggedIn, load]);

  if (!ready) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">加载中…</p>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">请先登录。</p>
        <Link href={WORKBENCH_HOME_PATH} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          前往工作台
        </Link>
      </main>
    );
  }

  const candidates = items.filter((p) => isShownotesOnlyClipProject(p) && clipProjectHasMaterial(p));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">继续 Shownotes</h1>
          <p className="mt-1 text-sm text-muted">选择已有音频任务；将打开独立 Shownotes 页。</p>
        </div>
        <Link href={WORKBENCH_PODCAST_SHOWNOTES_PATH} className="text-sm font-medium text-brand hover:underline">
          返回 Shownotes 首页
        </Link>
      </div>
      {err ? <p className="mt-4 text-sm text-danger-ink">{err}</p> : null}
      <div className="mt-8">
        {loading ? <p className="text-sm text-muted">加载工程列表…</p> : null}
        {!loading && candidates.length === 0 ? (
          <p className="rounded-xl border border-line bg-fill/30 px-4 py-6 text-sm text-muted">
            暂无含音频的任务。请先在{" "}
            <Link href={WORKBENCH_PODCAST_SHOWNOTES_PATH} className="font-medium text-brand hover:underline">
              Shownotes 首页
            </Link>{" "}
            上传音频。
          </p>
        ) : null}
        <ul className="mt-4 space-y-2">
          {candidates.map((p) => (
            <li key={p.id}>
              <Link
                href={podcastShownotesMakeHref(p.id)}
                className="flex items-center justify-between rounded-xl border border-line/80 bg-fill/25 px-4 py-3 text-sm transition hover:border-brand/35 hover:bg-fill/45"
              >
                <span className="min-w-0 truncate font-medium text-ink">{shownotesProjectDisplayTitle(p)}</span>
                <span className="ml-3 shrink-0 text-xs text-muted">{p.transcription_status || "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
