"use client";

import type { StudioAgentTurn } from "../../lib/studioWorkTypes";
import StudioAgentMessage from "./StudioAgentMessage";

export default function StudioTurnGroupBlock({
  userTurn,
  assistantTurns,
  stickyUser,
  userAnchor,
  streamingPhase,
  canEdit,
  onEditUserTurn
}: {
  userTurn: StudioAgentTurn;
  assistantTurns: StudioAgentTurn[];
  stickyUser?: boolean;
  userAnchor?: "active" | "history";
  streamingPhase?: string;
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
}) {
  return (
    <div className="space-y-1" data-studio-turn-group={userTurn.id}>
      <StudioAgentMessage
        turn={userTurn}
        stickyUser={stickyUser}
        userAnchor={userAnchor}
        canEdit={canEdit}
        onEditUserTurn={onEditUserTurn}
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
