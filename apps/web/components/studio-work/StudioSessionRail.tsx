"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { createStudioWork, listStudioWorks } from "../../lib/studioWorkStorage";
import type { StudioWork } from "../../lib/studioWorkTypes";
import { workStatusLabel } from "../../lib/studioWorkTypes";

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
  }, [refresh, activeWorkId]);

  function onNewAgent() {
    const w = createStudioWork();
    router.push(`${WORKBENCH_STUDIO_PATH}/${w.id}`);
  }

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
          title="New Agent"
          className="rounded-md bg-brand/10 p-1.5 text-brand hover:bg-brand/20"
          onClick={onNewAgent}
        >
          +
        </button>
        <Link
          href={WORKBENCH_STUDIO_PATH}
          title="全部"
          className="rounded-md p-1.5 text-[10px] text-muted hover:text-brand"
        >
          ≡
        </Link>
      </aside>
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-fill/15">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <button
          type="button"
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
          return (
            <Link
              key={w.id}
              href={`${WORKBENCH_STUDIO_PATH}/${w.id}`}
              className={[
                "mb-1 block rounded-lg px-2 py-1.5 text-xs transition",
                active ? "bg-brand/10 text-brand" : "text-ink hover:bg-fill/60"
              ].join(" ")}
            >
              <p className="truncate font-medium">{w.title || "新任务"}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted">
                {workStatusLabel(w.status)}
                {w.binding.noteIds.length ? ` · ${w.binding.noteIds.length}篇` : ""}
              </p>
            </Link>
          );
        })}
        {works.length === 0 ? (
          <p className="px-1 text-[11px] text-muted">暂无任务，点 New Agent 开始</p>
        ) : null}
      </div>
      <div className="border-t border-line p-2">
        <Link href={WORKBENCH_STUDIO_PATH} className="text-[11px] text-muted hover:text-brand">
          创作首页
        </Link>
      </div>
    </aside>
  );
}
