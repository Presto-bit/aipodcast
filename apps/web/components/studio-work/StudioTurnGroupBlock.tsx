"use client";

import type { StudioAgentTurn } from "../../lib/studioWorkTypes";
import StudioAgentMessage from "./StudioAgentMessage";

export default function StudioTurnGroupBlock({
  userTurn,
  assistantTurns,
  stickyUser,
  userAnchor,
  streamingPhase
}: {
  userTurn: StudioAgentTurn;
  assistantTurns: StudioAgentTurn[];
  stickyUser?: boolean;
  userAnchor?: "active" | "history";
  streamingPhase?: string;
}) {
  return (
    <div className="space-y-2" data-studio-turn-group={userTurn.id}>
      <StudioAgentMessage
        turn={userTurn}
        stickyUser={stickyUser}
        userAnchor={userAnchor}
      />
      {assistantTurns.map((turn) => (
        <StudioAgentMessage
          key={turn.id}
          turn={turn}
          streamingPhase={turn.streaming ? streamingPhase : undefined}
        />
      ))}
    </div>
  );
}
