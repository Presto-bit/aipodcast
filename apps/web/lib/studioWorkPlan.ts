import { finalizeExpertIntake, formatIntakeInferenceSummary, inferIntakePreselection } from "./composerExpertIntake";
import { featureCoreStatusSummary, isFeatureCoreComplete } from "./homeComposerFeatureCore";
import { fetchComposerExpertIntake } from "./homeComposerIntakeApi";
import type { StudioPlan, StudioWork } from "./studioWorkTypes";
import { taskSentenceFromWork } from "./studioWorkTask";

export async function buildPlanForWork(
  work: StudioWork,
  authHeaders: Record<string, string>
): Promise<{ work: StudioWork; plan: StudioPlan }> {
  const taskSentence = taskSentenceFromWork(work);
  let intake = { ...work.intake };
  let hint: string | undefined;

  try {
    const api = await fetchComposerExpertIntake(
      {
        expertId: "xhs_ops",
        taskSentence,
        intakeStep: 0,
        intake: {},
        notebook: work.binding.notebook,
        noteCount: work.binding.noteIds.length,
        featureCore: work.featureCore,
        personalEnabled: isFeatureCoreComplete(work.featureCore)
      },
      authHeaders
    );
    intake = { ...intake, ...api.preselected };
    hint = api.hint;
  } catch {
    const inferred = inferIntakePreselection("xhs_ops", taskSentence);
    intake = { ...intake, ...inferred.intake };
    hint = inferred.hint;
  }

  intake = finalizeExpertIntake("xhs_ops", intake, taskSentence);
  const inferenceSummary = formatIntakeInferenceSummary("xhs_ops", intake);

  const materialCount = work.binding.noteIds.length;
  const materialLabels =
    materialCount > 0
      ? [`${work.binding.notebook || "笔记本"} · ${materialCount} 篇`]
      : [];

  const risks: string[] = [];
  if (materialCount === 0) {
    risks.push("未绑定资料：将结合通识参考生成");
  }

  const outline = [
    "开头钩子（痛点/反常识）",
    "主体：分点清单或步骤",
    "结尾：行动建议或互动引导",
    hint ? `提示：${hint}` : ""
  ].filter(Boolean);

  const plan: StudioPlan = {
    goal: taskSentence || "待用户描述的创作任务",
    outline,
    materialLabels,
    materialCount,
    voiceEnabled: isFeatureCoreComplete(work.featureCore),
    voiceSummary: featureCoreStatusSummary(work.featureCore) || "未填写",
    risks,
    inferenceSummary
  };

  const title = taskSentence.slice(0, 48) || work.title;
  const nextWork: StudioWork = {
    ...work,
    title,
    brief: taskSentence,
    intake,
    plan,
    status: "planned",
    error: undefined
  };

  return { work: nextWork, plan };
}
