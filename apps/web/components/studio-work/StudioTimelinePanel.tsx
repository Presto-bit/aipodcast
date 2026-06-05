"use client";

import type { ReactNode, RefObject } from "react";
import { buildStudioTimeline } from "../../lib/studioTimeline";
import type { ManuscriptBlock, StudioAgentTurn, StudioWork } from "../../lib/studioWorkTypes";
import StudioTurnGroupBlock from "./StudioTurnGroupBlock";
import StudioTimelineManuscriptCard from "./StudioTimelineManuscriptCard";

export default function StudioTimelinePanel({
  work,
  turns,
  streamingPhase,
  scrollRef,
  canEdit,
  onEditUserTurn,
  emptyHint,
  busy,
  hideManuscript,
  onTitleIndexChange,
  onBlocksChange,
  showFeatureNudge,
  onFillFeature,
  onDismissFeatureNudge,
  streamingBlocks = null,
  streamingBodyText = null,
  activeAgentStatus = null
}: {
  work: StudioWork;
  turns: StudioAgentTurn[];
  streamingPhase?: string;
  scrollRef: RefObject<HTMLDivElement>;
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
  emptyHint?: string;
  busy: boolean;
  hideManuscript?: boolean;
  onTitleIndexChange?: (index: number) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  showFeatureNudge: boolean;
  onFillFeature: () => void;
  onDismissFeatureNudge: () => void;
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  activeAgentStatus?: ReactNode;
}) {
  void scrollRef;
  const items = buildStudioTimeline(work, turns, { hideManuscript: hideManuscript });

  return (
    <div className="px-0.5">
      {!turns.length && emptyHint ? (
        <p className="py-6 text-center text-sm text-muted">{emptyHint}</p>
      ) : null}

      <div className="space-y-5">
        {items.map((item) => {
          if (item.kind === "turn-group") {
            return (
              <div key={`group-${item.group.id}`}>
                <StudioTurnGroupBlock
                  userTurn={item.group.userTurn}
                  assistantTurns={item.group.assistantTurns}
                  userAnchor={item.isActive ? "active" : "history"}
                  streamingPhase={item.isActive ? streamingPhase : undefined}
                  canEdit={canEdit}
                  onEditUserTurn={onEditUserTurn}
                />
                {item.isActive && activeAgentStatus ? (
                  <div className="mt-2">{activeAgentStatus}</div>
                ) : null}
              </div>
            );
          }

          return (
            <StudioTimelineManuscriptCard
              key={`ms-${item.run.id}`}
              work={work}
              run={item.run}
              version={item.version}
              baseVersion={item.baseVersion}
              isActiveVersion={item.isActiveVersion}
              busy={busy}
              onTitleIndexChange={onTitleIndexChange}
              onBlocksChange={onBlocksChange}
              streamingBlocks={streamingBlocks}
              streamingBodyText={streamingBodyText}
            />
          );
        })}
      </div>

      {showFeatureNudge ? (
        <p className="mt-6 text-[11px] text-muted">
          下一篇想更像自己，可去对话页填写「我的特色」。
          <button type="button" className="ml-1 text-brand underline" onClick={onFillFeature}>
            去填写
          </button>
          <button type="button" className="ml-2 text-muted underline" onClick={onDismissFeatureNudge}>
            暂不
          </button>
        </p>
      ) : null}
    </div>
  );
}
