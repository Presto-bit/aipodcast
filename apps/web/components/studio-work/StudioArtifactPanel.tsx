"use client";

import type { ManuscriptBlock, ManuscriptVersion, StudioWork } from "../../lib/studioWorkTypes";
import StudioManuscriptPanel from "./StudioManuscriptPanel";

export default function StudioArtifactPanel({
  work,
  tab,
  onTabChange,
  version,
  compareBlocks,
  compareMode,
  selectedKeys,
  changedKeys,
  onToggleKey,
  onShipCheck,
  readOnly,
  collapsed,
  onToggleCollapse
}: {
  work: StudioWork;
  tab: "manuscript" | "ship";
  onTabChange: (t: "manuscript" | "ship") => void;
  version: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[];
  compareMode: boolean;
  selectedKeys: Set<string>;
  changedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onShipCheck: (id: string, v: boolean) => void;
  readOnly: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center border-l border-line bg-fill/10 py-2">
        <button
          type="button"
          title="展开稿件"
          className="rounded p-1 text-muted hover:bg-fill hover:text-ink"
          onClick={onToggleCollapse}
        >
          «
        </button>
        <span
          className="mt-4 text-[10px] text-muted"
          style={{ writingMode: "vertical-rl" }}
        >
          稿件
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex w-[min(100%,420px)] shrink-0 flex-col border-l border-line bg-surface lg:w-[38%]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-2">
        <span className="text-xs font-medium text-ink">稿件 / 发布包</span>
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-fill"
          title="收起"
          onClick={onToggleCollapse}
        >
          »
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <StudioManuscriptPanel
          tab={tab}
          onTabChange={onTabChange}
          version={version}
          compareBlocks={compareBlocks}
          compareMode={compareMode}
          selectedKeys={selectedKeys}
          changedKeys={changedKeys}
          onToggleKey={onToggleKey}
          shipChecks={work.shipChecks}
          onShipCheck={onShipCheck}
          readOnly={readOnly}
        />
      </div>
    </aside>
  );
}
