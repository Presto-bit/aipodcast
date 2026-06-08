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
    intake.contentAngle = "story";
    intake.noteType = "story";
    intake.structure = "story_arc";
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
    "禁止📌先说结论/💡展开/要点一二三/与任务无关的通用护肤熬夜脸垮等模板骨架。",
    "小红书原生：第一人称口语、2～4行一段（单段≤80字）、短句留白；清单用·或①②③一行一点。",
    "正文须为自然段，引用任务里的真实产品名与使用场景。",
    `创作任务：${taskSentence.trim().slice(0, 600)}`
  ].join("\n");
}

/** 改版 Job：附带当前稿件摘要，避免模型脱离上下文 */
export function buildStudioReviseTaskSentence(
  baseTask: string,
  manuscriptPlain: string,
  opinion: string
): string {
  const clip = manuscriptPlain.trim().slice(0, 2400);
  return [
    baseTask.trim(),
    clip ? `【当前稿件】\n${clip}` : "",
    `改版意见：${opinion.trim()}`
  ]
    .filter(Boolean)
    .join("\n\n");
}
