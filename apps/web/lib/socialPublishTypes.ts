export type SocialPublishPlatform = "xiaohongshu" | "wechat_mp";

export type SocialPublishIntent = "zhongcao" | "dry_goods" | "opinion" | "checklist" | "story";
export type SocialPublishAudience = "beginner" | "general" | "pro";
export type SocialPublishLength = "short" | "medium" | "long";
export type SocialPublishTone = "casual" | "pro" | "humor" | "motivational";

export type SocialPublishSourceType = "ask_answer" | "article_job" | "podcast_job" | "notes_only";

export type SocialPublishWizardStep = "platform" | "options" | "source" | "generating" | "result";

export type SocialPublishQuickOptions = {
  intent: SocialPublishIntent;
  audience: SocialPublishAudience;
  length: SocialPublishLength;
};

export type SocialPublishAdvancedOptions = {
  tone: SocialPublishTone;
  mustInclude: string[];
  avoid: string[];
  userNote: string;
  useRecommendedBundle: boolean;
  /** 小红书 */
  noteForm: "image_text" | "video_caption";
  emojiLevel: "rich" | "medium" | "none";
  interaction: "comment" | "collect" | "follow" | "poll" | "none";
  wantTitleOptions: boolean;
  tagsMode: "vertical10" | "broad5" | "none";
  wantCoverSuggestions: boolean;
  /** 公众号 */
  mpArticleType: "headline" | "sub" | "brief";
  mpStructure: "intro_sections" | "qa" | "checklist" | "essay";
  wantDigest: boolean;
  mpCta: string[];
};

export type SocialPublishXhsDraft = {
  platform: "xiaohongshu";
  titles: string[];
  selectedTitleIndex: number;
  theme: string;
  body: string;
  tags: string[];
  interaction: string;
  coverSuggestions: string[];
};

export type SocialPublishMpDraft = {
  platform: "wechat_mp";
  title: string;
  digest: string;
  body: string;
  cta: string;
};

export type SocialPublishDraft = SocialPublishXhsDraft | SocialPublishMpDraft;

export type SocialPublishSourceCandidate = {
  key: string;
  type: SocialPublishSourceType;
  label: string;
  materialPreview: string;
  materialText: string;
  jobId?: string;
  recommended?: boolean;
};
