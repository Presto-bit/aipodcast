import { finalizeExpertIntake, inferIntakePreselection } from "./composerExpertIntake";

/** Studio 成稿 Job：从任务句推断 intake，并针对种草/推广场景纠偏 */
export function buildStudioJobIntake(
  taskSentence: string,
  existing: Record<string, string | string[]> = {}
): Record<string, string | string[]> {
  const inferred = inferIntakePreselection("xhs_ops", taskSentence);
  const intake = finalizeExpertIntake(
    "xhs_ops",
    { ...inferred.intake, ...existing },
    taskSentence
  );

  if (/推广|种草|带货|杯子|产品|新品|保温杯/.test(taskSentence)) {
    intake.contentAngle = "tutorial";
    intake.noteType = "howto";
    intake.structure = "steps";
    intake.publishGoal = "expose";
    intake.hookStyle = /提醒|喝水|杯子/.test(taskSentence) ? "scene" : "pain_question";
  }
  if (/职场|白领|上班族|打工人/.test(taskSentence)) {
    intake.audience = "peers";
  }
  return intake;
}

/** 约束模型勿把 intake 标签复述进正文 */
export function buildStudioAuthorPrompt(taskSentence: string): string {
  return [
    "围绕【创作任务】中的具体产品、卖点、受众场景写小红书种草/推广正文。",
    "禁止把「账号阶段/读者/切入角度」等偏好标签写进正文。",
    "禁止与任务无关的通用护肤、熬夜、脸垮等虚构案例。",
    `创作任务：${taskSentence.trim().slice(0, 600)}`
  ].join("\n");
}
