import { humanizeAgentStepLabel, humanizeComposePhase } from "./studioAgentReadable";
import type { StudioAgentStep } from "./studioAgentSteps";

/** 成稿前 3～5s 闪现：理解 → 路由 → 写稿（无正文流时） */
export function composeThinkingFlashText(
  steps: StudioAgentStep[],
  runPhase?: string
): string {
  const labels = steps
    .filter((s) => s.status === "running" || s.status === "done")
    .map((s) => humanizeAgentStepLabel(s))
    .filter((label, index, arr) => label && arr.indexOf(label) === index);

  if (labels.length >= 2) {
    return labels.slice(0, 4).join(" → ");
  }
  if (labels.length === 1) {
    return `${labels[0]} → 准备写稿…`;
  }
  const phase = humanizeComposePhase(runPhase || "");
  if (phase && phase !== "准备写稿…") {
    return `${phase} → 准备写稿…`;
  }
  return "理解需求 → 准备写稿…";
}
