"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { WORKBENCH_CHAT_PATH, WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { createStudioWork, listStudioWorks } from "../../lib/studioWorkStorage";
import { formatWorkCardMeta } from "../../lib/studioWorkCard";
import type { StudioWork } from "../../lib/studioWorkTypes";

function WorkRow({ work }: { work: StudioWork }) {
  const material =
    work.binding.noteIds.length > 0
      ? `资料 ${work.binding.noteIds.length}`
      : "资料 0";
  return (
    <Link
      href={`${WORKBENCH_STUDIO_PATH}/${work.id}`}
      className="block rounded-xl border border-line bg-surface p-4 transition hover:border-brand/35 hover:bg-fill/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="truncate font-medium text-ink">{work.title || "未命名"}</span>
        </div>
        {work.pendingPatch ? (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
            待确认
          </span>
        ) : work.status === "generating" ? (
          <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            生成中
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {formatWorkCardMeta(work)} · {material}
      </p>
      {work.status === "generating" && work.runPhase ? (
        <p className="mt-1 text-xs text-brand">{work.runPhase}</p>
      ) : null}
      {work.error ? <p className="mt-1 text-xs text-danger-ink">{work.error}</p> : null}
    </Link>
  );
}

export default function StudioWorksListClient() {
  const router = useRouter();
  const { ready, user } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [works, setWorks] = useState<StudioWork[]>([]);

  const refresh = useCallback(() => {
    setWorks(listStudioWorks());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, isLoggedIn, refresh]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  function onNew() {
    const w = createStudioWork();
    router.push(`${WORKBENCH_STUDIO_PATH}/${w.id}`);
  }

  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-2xl flex-col px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">创作</h1>
        <button
          type="button"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
          onClick={onNew}
        >
          新建小红书任务
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">说清楚需求后自动写稿，支持对话澄清、版本对比与部分采纳。</p>

      <div className="mt-6 flex flex-col gap-3">
        {works.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-fill/20 px-4 py-10 text-center">
            <p className="text-sm text-muted">还没有创作任务</p>
            <button
              type="button"
              className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
              onClick={onNew}
            >
              新建小红书任务
            </button>
          </div>
        ) : (
          works.map((w) => <WorkRow key={w.id} work={w} />)
        )}
      </div>

      <footer className="mt-auto flex flex-wrap gap-4 pt-8 text-xs text-muted">
        <Link href={WORKBENCH_CHAT_PATH} className="hover:text-brand">
          经典对话 →
        </Link>
        <Link href="/works" className="hover:text-brand">
          已生成作品 →
        </Link>
      </footer>
    </main>
  );
}
