export const LISTENHUB_CREATIVE_HINTS = [
  "将你最感兴趣的一本书或一篇文章，做成一期深度闲聊播客。",
  "把最近一周的科技新闻，整理成一期「划重点」对话节目。",
  "用轻松语气讲解一个职业或技能入门，面向完全外行听众。"
] as const;

export const MAIN_TEXT_PLACEHOLDER = "主题或素材正文";
export const PODCAST_PREFS_KEY = "fym_podcast_user_prefs_v1";
export const PARTIAL_REDO_KEY = "fym_podcast_partial_redo_v1";
export const PODCAST_REUSE_TEMPLATE_KEY = "fym_reuse_template_podcast_v1";

export type PartialRedoMeta = {
  sourceJobId?: string;
  scopeLabel: string;
  prompt: string;
};
