import type { StudioRouteDecision } from "./studioOrchestrator";

/** 成稿后自动追问（仅 API，不在对话区展示用户句） */
export const STUDIO_POST_DONE_INTERNAL_QUESTION =
  "成稿刚完成。请用2-4句话解读标题与正文亮点，各给1条可选下一步（如微调标题），勿重复全文，勿要求再次确认任务或确认执行。";

export const STUDIO_POST_DONE_AUTHOR_EXTRA = [
  "【成稿后引导】",
  "稿件已生成。用2-4句话解读亮点，各给1条可选下一步；",
  "勿重复粘贴全文；勿要求用户再次「确认任务」或「确认执行」；",
  "若用户要改版，提示在产物区输入改版意见后提交。"
].join("\n");

export function buildPostDoneFollowUpRoute(): StudioRouteDecision {
  return {
    tool: "ask",
    intent: "manuscript_coach",
    note: "成稿后解读与下一步",
    askContext: { includeManuscript: true, includeMemory: false }
  };
}
