import { composeTaskSentenceFromTurns } from "./studioWorkTask";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

/** V2：门禁已全部删除 — 不再展示 blocking hint */
export function studioOrchestratorHint(
  _work: StudioWork,
  draftInput: string,
  _turns?: StudioAgentTurn[]
): string | null {
  const q = draftInput.trim();
  if (!q) return null;
  const composeTask = composeTaskSentenceFromTurns(_turns ?? _work.agentTurns, q);
  if (composeTask.length > 0 && composeTask.length < 12) {
    return "信息较少，将按默认假设写稿";
  }
  return null;
}
