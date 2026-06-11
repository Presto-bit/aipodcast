/** 本轮 Agent 目标：显式约束 Planner 路由（非门禁） */

export type StudioExplicitGoal = "auto" | "compose" | "revise" | "ask";

export const STUDIO_EXPLICIT_GOALS: StudioExplicitGoal[] = ["auto", "compose", "revise", "ask"];

export function studioExplicitGoalLabel(goal: StudioExplicitGoal): string {
  switch (goal) {
    case "compose":
      return "写稿";
    case "revise":
      return "改版";
    case "ask":
      return "问答";
    default:
      return "自动";
  }
}

export function normalizeStudioExplicitGoal(raw: unknown): StudioExplicitGoal {
  const g = String(raw || "").trim().toLowerCase();
  if (g === "compose" || g === "revise" || g === "ask") return g;
  return "auto";
}

/** 有选区时默认改版；否则沿用 work 设定 */
export function resolveStreamExplicitGoal(
  workGoal: StudioExplicitGoal | undefined,
  hasSelection: boolean
): StudioExplicitGoal {
  if (hasSelection) return "revise";
  return normalizeStudioExplicitGoal(workGoal);
}
