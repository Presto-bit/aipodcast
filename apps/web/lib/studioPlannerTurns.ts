/** 发给 Planner / agent_stream 的对话视图（去 ack、去 streaming 占位） */

import { isStudioComposeAckTurn } from "./studioTimeline";
import type { StudioAgentTurn } from "./studioWorkTypes";

export function plannerAgentTurns(turns: StudioAgentTurn[]): Array<{ role: string; content: string }> {
  return turns
    .filter((t) => !t.streaming && !isStudioComposeAckTurn(t))
    .map((t) => ({
      role: t.role,
      content: t.content.trim()
    }))
    .filter((t) => t.content.length > 0);
}
