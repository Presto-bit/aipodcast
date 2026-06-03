import type { ComposerExpertSelection, ExpertTaskDraft } from "./homeComposerExpertTypes";

export type ComposerWorkflowPhase =
  | "chat"
  | "standby"
  | "resolution"
  | "executing"
  | "review";

export function resolveComposerWorkflowPhase(
  expert: ComposerExpertSelection | undefined,
  draft: ExpertTaskDraft | undefined
): ComposerWorkflowPhase {
  if (expert?.mode !== "platform") return "chat";
  if (!draft) return "standby";
  switch (draft.phase) {
    case "intake":
    case "confirm":
      return "resolution";
    case "generate":
      return "executing";
    case "deliver":
      return "review";
    case "review":
      return "review";
    case "revise":
      return "executing";
    default:
      return "standby";
  }
}

const WORKFLOW_LABELS: Record<ComposerWorkflowPhase, string> = {
  chat: "聊天中",
  standby: "待命",
  resolution: "确认需求",
  executing: "生成中",
  review: "可发布"
};

export function composerWorkflowLabel(
  expert: ComposerExpertSelection | undefined,
  draft: ExpertTaskDraft | undefined
): string {
  return WORKFLOW_LABELS[resolveComposerWorkflowPhase(expert, draft)];
}
