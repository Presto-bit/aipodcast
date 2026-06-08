"use client";

import { isStudioComposeAckTurn } from "../../lib/studioTimeline";
import type { StudioAgentTurn } from "../../lib/studioWorkTypes";
import StudioAgentMessage from "./StudioAgentMessage";
import StudioEphemeralHint from "./StudioEphemeralHint";

export default function StudioTurnGroupBlock({
  userTurn,
  assistantTurns,
  userAnchor,
  streamingPhase,
  canEdit,
  onEditUserTurn
}: {
  userTurn: StudioAgentTurn;
  assistantTurns: StudioAgentTurn[];
  userAnchor?: "active" | "history";
  streamingPhase?: string;
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
}) {
  return (
    <div className="space-y-1" data-studio-turn-group={userTurn.id}>
      <StudioAgentMessage
        turn={userTurn}
        userAnchor={userAnchor}
        canEdit={canEdit}
        onEditUserTurn={onEditUserTurn}
      />
      {assistantTurns.map((turn) =>
        isStudioComposeAckTurn(turn) ? (
          <StudioEphemeralHint key={turn.id} text={turn.content} ttlMs={4000} />
        ) : (
          <StudioAgentMessage
            key={turn.id}
            turn={turn}
            streamingPhase={turn.streaming ? streamingPhase : undefined}
          />
        )
      )}
    </div>
  );
}
