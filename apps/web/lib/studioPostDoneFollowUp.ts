import type { StudioRouteDecision } from "./studioOrchestrator";

/** 成稿后自动附言（稿件下流式点评）— 已关闭：易呈现「刚看完你这篇」等第三方口吻 */
export const STUDIO_POST_DONE_COACH_ENABLED = false;

/** 成稿后温和附言（仅 API，不在对话区展示用户句） */
export const STUDIO_POST_DONE_INTERNAL_QUESTION =
  "稿件刚写好。请像同事一样用简短、温和口语和用户聊几句：顺带说说这篇最好的一点，再提一个她可以自己做的小调整。不要列小标题，不要写「亮点解读」「可选下一步」等字样，不要重复粘贴全文。";

export const STUDIO_POST_DONE_AUTHOR_EXTRA = [
  "【语气】自然、温和、口语化，像在任务后面顺便聊两句。",
  "不要用小标题、编号或「亮点」「下一步」等标签。",
  "勿要求再次确认任务或开始生成。",
  "若她想改稿，提醒在下方输入框直接说即可。"
].join("\n");

export function buildPostDoneFollowUpRoute(): StudioRouteDecision {
  return {
    tool: "ask",
    intent: "manuscript_coach",
    note: "",
    askContext: { includeManuscript: true, includeMemory: false }
  };
}
