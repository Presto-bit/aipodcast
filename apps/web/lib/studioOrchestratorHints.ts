import {
  isInsufficientBrief,
  needsPromoBriefClarification,
  wouldAutoGenerate
} from "./studioOrchestrator";
import type { StudioWork } from "./studioWorkTypes";

/** P2：编排提示 chip，替代用户猜 implicit 正则 */
export function studioOrchestratorHint(work: StudioWork, draftInput: string): string | null {
  const q = draftInput.trim();
  if (!q) return null;
  if (wouldAutoGenerate(work, q)) return null;
  if (needsPromoBriefClarification(q)) {
    return "推广类笔记：补一句受众、卖点或使用场景，即可自动开写";
  }
  if (isInsufficientBrief(q)) {
    return "再补充主题、形式或受众中的任一项，即可自动开写";
  }
  return null;
}
