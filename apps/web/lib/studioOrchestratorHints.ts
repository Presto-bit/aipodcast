import {
  isInsufficientBrief,
  needsPromoBriefClarification,
  wouldAutoGenerate
} from "./studioOrchestrator";
import { composeTaskSentenceFromTurns } from "./studioWorkTask";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

/** P2：编排提示 chip，替代用户猜 implicit 正则 */
export function studioOrchestratorHint(
  work: StudioWork,
  draftInput: string,
  turns?: StudioAgentTurn[]
): string | null {
  const q = draftInput.trim();
  if (!q) return null;
  const composeTask = composeTaskSentenceFromTurns(turns ?? work.agentTurns, q);
  if (wouldAutoGenerate(work, q, turns)) return null;
  if (needsPromoBriefClarification(composeTask)) {
    return "推广类笔记：补一句受众、卖点或使用场景，即可自动开写";
  }
  if (isInsufficientBrief(composeTask)) {
    return "再补充主题、形式或受众中的任一项，即可自动开写";
  }
  return null;
}
