import type {
  AssistantBlock,
  ExpertDeliverable,
  ExpertTaskDraft,
  FeatureCore,
  MaterialPlan,
  PlatformExpertId
} from "./homeComposerExpertTypes";
import type { HomeComposerPrefs } from "./homeComposerTypes";
import { EXPERT_DISPLAY_NAMES } from "./composerExperts";
import { featureCoreStatusSummary, isFeatureCoreComplete } from "./homeComposerFeatureCore";
import {
  buildIntakeStepBlock,
  expertStripBlock,
  inferIntakePreselection,
  intakeFieldHint,
  intakeTotalSteps
} from "./composerExpertIntake";

export function createExpertTaskDraft(params: {
  expertId: PlatformExpertId;
  taskSentence: string;
  turnId: string;
  intake?: Record<string, string | string[]>;
  intakeStep?: number;
  phase?: ExpertTaskDraft["phase"];
}): ExpertTaskDraft {
  return {
    expertId: params.expertId,
    phase: params.phase ?? "intake",
    taskSentence: params.taskSentence.trim(),
    intake: params.intake ?? {},
    intakeStep: params.intakeStep ?? 0,
    turnId: params.turnId,
    updatedAt: new Date().toISOString()
  };
}

export function buildMaterialPlan(prefs: HomeComposerPrefs): MaterialPlan | undefined {
  const notebook = prefs.notebook.trim();
  if (!notebook) return undefined;
  const noteCount = prefs.noteIds.length;
  return {
    notebook,
    noteCount,
    intendedUse: "案例细节、产品名、时间线",
    coverageEstimate: noteCount > 0 ? "partial" : "none",
    disclaimer: noteCount > 0 ? undefined : "笔记本暂无已索引篇目"
  };
}

export function buildConfirmBlock(
  expertId: PlatformExpertId,
  taskSentence: string,
  intake: Record<string, string | string[]>,
  prefs: HomeComposerPrefs
): Extract<AssistantBlock, { kind: "confirm" }> {
  const materialPlan = buildMaterialPlan(prefs);
  const featureSummary = featureCoreStatusSummary(prefs.featureCore);
  const featureEnabled = Boolean(prefs.personalEnabled && isFeatureCoreComplete(prefs.featureCore));
  const kbOn = Boolean(materialPlan?.notebook);

  const toolchain: string[] = [];
  if (kbOn && materialPlan) {
    toolchain.push(`你的 ${materialPlan.noteCount || "全部"} 篇资料`);
  }
  toolchain.push(EXPERT_DISPLAY_NAMES[expertId]);
  if (kbOn) toolchain.push("资料不足处补充");

  const block: Extract<AssistantBlock, { kind: "confirm" }> = {
    kind: "confirm",
    summary: taskSentence,
    intake,
    toolchain
  };

  if (materialPlan) block.materialPlan = materialPlan;

  if (featureEnabled && featureSummary) {
    block.featureStrip = { enabled: true, summary: featureSummary };
  }

  return block;
}

export function buildExpertOutputContextParts(params: {
  expertId: PlatformExpertId;
  writingHabitLabel: string;
  featureSummary?: string;
  featureEnabled?: boolean;
  notebook?: string;
}): string[] {
  const parts = [EXPERT_DISPLAY_NAMES[params.expertId]];
  if (params.notebook?.trim()) {
    parts.push(`资料 · ${params.notebook.trim()}`);
  }
  parts.push(`写作习惯 · ${params.writingHabitLabel}`);
  if (params.featureEnabled && params.featureSummary?.trim()) {
    parts.push(`我的特色 · ${params.featureSummary.trim()}`);
  }
  return parts;
}

export function blocksForIntakePhase(
  expertId: PlatformExpertId,
  intakeStep: number,
  intake: Record<string, string | string[]>,
  taskSentence: string
): AssistantBlock[] {
  const hint = intakeFieldHint(expertId, intake) ?? inferIntakePreselection(expertId, taskSentence).hint;
  return [expertStripBlock(expertId), buildIntakeStepBlock(expertId, intakeStep, intake, hint)];
}

export function blocksForConfirmPhase(
  expertId: PlatformExpertId,
  taskSentence: string,
  intake: Record<string, string | string[]>,
  prefs: HomeComposerPrefs
): AssistantBlock[] {
  return [expertStripBlock(expertId), buildConfirmBlock(expertId, taskSentence, intake, prefs)];
}

export function rebuildBlocksFromDraft(draft: ExpertTaskDraft, prefs: HomeComposerPrefs): AssistantBlock[] {
  if (draft.phase === "confirm") {
    return blocksForConfirmPhase(draft.expertId, draft.taskSentence, draft.intake, prefs);
  }
  if (draft.phase === "intake") {
    return blocksForIntakePhase(draft.expertId, draft.intakeStep, draft.intake, draft.taskSentence);
  }
  return [expertStripBlock(draft.expertId)];
}

export function canComposerSubmitTask(draft: ExpertTaskDraft | undefined): boolean {
  if (!draft) return true;
  return draft.phase === "deliver" || draft.phase === "revise" || draft.phase === "idle";
}

export function composerInputPlaceholder(draft: ExpertTaskDraft | undefined): string {
  if (draft?.phase === "intake" || draft?.phase === "confirm") {
    return "先完成上方选项，或点「改聊一下」";
  }
  if (draft?.phase === "generate") {
    return "正在生成…";
  }
  return "消息…";
}

export function summarizeIntakeForDisplay(intake: Record<string, string | string[]>): string {
  return Object.entries(intake)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("、") : v}`)
    .join(" · ");
}

export function featureStripLine(featureCore: FeatureCore | undefined, enabled: boolean): string {
  if (!enabled || !isFeatureCoreComplete(featureCore)) return "";
  return featureCoreStatusSummary(featureCore);
}

export function buildProgressBlock(
  message: string,
  progress = 0,
  hasNotes = false
): Extract<AssistantBlock, { kind: "progress" }> {
  const steps: Extract<AssistantBlock, { kind: "progress" }>["steps"] = [];
  if (hasNotes) {
    const materialDone = progress >= 20;
    steps.push({
      label: "检索资料",
      status: materialDone ? "done" : progress > 0 ? "active" : "pending"
    });
  }
  const contentDone = progress >= 100;
  const contentActive = progress >= (hasNotes ? 55 : 8);
  const opsActive = progress >= 55 && progress < 100;
  steps.push({
    label: "生成内容成品",
    status: contentDone ? "done" : contentActive ? "active" : "pending"
  });
  steps.push({
    label: "生成发布傻瓜包（7 步）",
    status: contentDone ? "done" : opsActive ? "active" : "pending"
  });
  return { kind: "progress", steps };
}

export function buildDeliverableBlock(
  expertId: PlatformExpertId,
  deliverable: ExpertDeliverable
): Extract<AssistantBlock, { kind: "deliverable" }> {
  return {
    kind: "deliverable",
    expertId,
    content: deliverable.content,
    ops: deliverable.ops,
    meta: deliverable.meta
  };
}

export const EXPERT_FEEDBACK_CHIPS: Record<PlatformExpertId, string[]> = {
  xhs_ops: ["换标题", "缩短", "更口语", "更贴我的材料"],
  mp_ops: ["换标题", "缩短", "更正式", "更贴我的材料"],
  voice_gen: ["缩短", "更口语", "加强开头", "更贴我的材料"],
  podcast_plan: ["缩短大纲", "更口语", "加强开头", "更贴我的材料"]
};

export function buildFeedbackBlock(
  deliverableId: string,
  expertId: PlatformExpertId,
  hasNotes = false
): Extract<AssistantBlock, { kind: "feedback" }> {
  let chips = EXPERT_FEEDBACK_CHIPS[expertId] ?? ["换标题", "缩短", "更口语"];
  if (!hasNotes) {
    chips = chips.filter((c) => c !== "更贴我的材料");
  }
  return {
    kind: "feedback",
    deliverableId,
    chips
  };
}

export function buildGenerateErrorBlock(message: string): Extract<AssistantBlock, { kind: "progress" }> {
  return {
    kind: "progress",
    steps: [
      { label: "生成失败", status: "active" },
      { label: message.slice(0, 80), status: "pending" }
    ]
  };
}
