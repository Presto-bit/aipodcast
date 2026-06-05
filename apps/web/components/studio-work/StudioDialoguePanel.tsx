"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import {
  buildStudioDialogueTurnGroups,
  shouldVirtualizeDialogueHistory,
  splitActiveDialogueGroups
} from "../../lib/studioDialogueTurnGroups";
import { STUDIO_DIALOGUE_SECTION } from "../../lib/studioOutputTypography";
import type { StudioAgentTurn } from "../../lib/studioWorkTypes";
import StudioTurnGroupBlock from "./StudioTurnGroupBlock";

const HISTORY_GROUP_ESTIMATE = 96;

export default function StudioDialoguePanel({
  turns,
  streamingPhase,
  scrollRef
}: {
  turns: StudioAgentTurn[];
  streamingPhase?: string;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const groups = buildStudioDialogueTurnGroups(turns);
  const { history, active } = splitActiveDialogueGroups(groups);
  const virtualizeHistory = shouldVirtualizeDialogueHistory(history.length);

  const virtualizer = useVirtualizer({
    count: virtualizeHistory ? history.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HISTORY_GROUP_ESTIMATE,
    overscan: 4
  });

  if (!turns.length) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className={`${STUDIO_DIALOGUE_SECTION} shrink-0 px-0.5`}>对话</p>
      <div ref={scrollRef} className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {virtualizeHistory ? (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const group = history[row.index];
              if (!group) return null;
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <StudioTurnGroupBlock
                    userTurn={group.userTurn}
                    assistantTurns={group.assistantTurns}
                    userAnchor="history"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {history.map((group) => (
              <StudioTurnGroupBlock
                key={group.id}
                userTurn={group.userTurn}
                assistantTurns={group.assistantTurns}
                userAnchor="history"
              />
            ))}
          </div>
        )}

        {active ? (
          <div className="pb-2 pt-1">
            <StudioTurnGroupBlock
              userTurn={active.userTurn}
              assistantTurns={active.assistantTurns}
              stickyUser
              userAnchor="active"
              streamingPhase={streamingPhase}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
