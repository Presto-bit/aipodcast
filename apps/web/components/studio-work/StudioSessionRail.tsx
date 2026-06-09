"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import {
  createStudioWork,
  deleteStudioWork,
  listStudioWorks
} from "../../lib/studioWorkStorage";
import { formatWorkCardMeta } from "../../lib/studioWorkCard";
import { isWorkStreamRunning } from "../../lib/studioWorkStreamRegistry";
import type { StudioWork } from "../../lib/studioWorkTypes";

export default function StudioSessionRail({
  activeWorkId,
  collapsed,
  onToggleCollapse
}: {
  activeWorkId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const router = useRouter();
  const [works, setWorks] = useState<StudioWork[]>([]);

  const refresh = useCallback(() => setWorks(listStudioWorks()), []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [refresh, activeWorkId]);

  function onNewAgent() {
    const w = createStudioWork();
    refresh();
    router.push(`${WORKBENCH_STUDIO_PATH}/${w.id}`);
  }

  function onDeleteWork(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    deleteStudioWork(id);
    const remaining = listStudioWorks();
    setWorks(remaining);
    if (id !== activeWorkId) return;
    if (remaining[0]) {
      router.replace(`${WORKBENCH_STUDIO_PATH}/${remaining[0].id}`);
      return;
    }
    const w = createStudioWork();
    router.replace(`${WORKBENCH_STUDIO_PATH}/${w.id}`);
  }

  const newAgentTitle = "New Agent";

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-line bg-fill/20 py-2">
        <button
          type="button"
          title="展开任务列表"
          className="rounded-md p-1.5 text-muted hover:bg-fill hover:text-ink"
          onClick={onToggleCollapse}
        >
          »
        </button>
        <button
          type="button"
          title={newAgentTitle}
          className="rounded-md bg-brand/10 p-1.5 text-brand hover:bg-brand/20"
          onClick={onNewAgent}
        >
          +
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-fill/15">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <button
          type="button"
          title={newAgentTitle}
          className="flex-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
          onClick={onNewAgent}
        >
          New Agent
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-fill"
          title="收起"
          onClick={onToggleCollapse}
        >
          «
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {works.map((w) => {
          const active = w.id === activeWorkId;
          const running = w.status === "generating" || isWorkStreamRunning(w.id);
          return (
            <div
              key={w.id}
              className={[
                "group relative mb-1 rounded-lg transition",
                active ? "bg-brand/10" : "hover:bg-fill/60"
              ].join(" ")}
            >
              <Link
                href={`${WORKBENCH_STUDIO_PATH}/${w.id}`}
                className={[
                  "block rounded-lg px-2 py-1.5 pr-7 text-xs",
                  active ? "text-brand" : "text-ink"
                ].join(" ")}
              >
                <p className="truncate font-medium">
                  {running && !active ? (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse" aria-hidden />
                  ) : null}
                  {w.title || "未命名"}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-muted">{formatWorkCardMeta(w)}</p>
              </Link>
              <button
                type="button"
                title="删除任务"
                aria-label="删除任务"
                className="absolute right-1 top-1.5 rounded p-0.5 text-[10px] text-muted opacity-0 transition hover:bg-fill hover:text-danger-ink group-hover:opacity-100"
                onClick={(e) => onDeleteWork(e, w.id)}
              >
                ✕
              </button>
            </div>
          );
        })}
        {works.length === 0 ? (
          <p className="px-1 text-[11px] text-muted">暂无任务，点 New Agent 开始</p>
        ) : null}
      </div>
    </aside>
  );
}
