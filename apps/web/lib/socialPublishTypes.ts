export type SocialPublishPlatform = "xiaohongshu" | "wechat_mp";

export type SocialPublishIntent = "zhongcao" | "dry_goods" | "opinion" | "checklist" | "story";
export type SocialPublishAudience = "beginner" | "general" | "pro";
export type SocialPublishTargetCharsPreset = "c400" | "c600" | "c1000" | "c1500" | "custom";

export type SocialPublishTone = "casual" | "pro" | "humor" | "motivational";

export type SocialPublishSourceType = "ask_answer" | "notes_only";

/** 小红书：目标人群定位 */
export type SocialPublishTargetGender = "female" | "male" | "any";
export type SocialPublishTargetAge = "18_24" | "25_34" | "35_44" | "45_plus" | "all_ages";
export type SocialPublishTargetRegion = "tier1" | "tier2" | "tier3_down" | "any";
export type SocialPublishTargetOccupation =
  | "office_worker"
  | "student"
  | "parent"
  | "freelancer"
  | "entrepreneur"
  | "creator"
  | "custom";

/** 小红书：写作人设（单选） */
export type SocialPublishWriterVoice =
  | "bestie_brother"
  | "expert_scholar"
  | "growth_companion"
  | "sharp_truth";

export type SocialPublishPersonaOptions = {
  gender: SocialPublishTargetGender;
  ageRange: SocialPublishTargetAge;
  region: SocialPublishTargetRegion;
  occupation: SocialPublishTargetOccupation;
  occupationCustom: string;
  writerVoice: SocialPublishWriterVoice;
  /** 其他要求（替代原高级选项补充说明） */
  otherRequirements: string;
};

export type SocialPublishCompliance = {
  status: "passed" | "auto_softened";
  hitCount: number;
  categories: string[];
  userMessage: string;
};

export type SocialPublishWizardStep = "platform" | "options" | "source" | "generating" | "result";

export type SocialPublishQuickOptions = {
  intent: SocialPublishIntent;
  audience: SocialPublishAudience;
  targetCharsPreset: SocialPublishTargetCharsPreset;
  targetChars: number;
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
  wantCoverSuggestions: boolean;
  coverHookStyle: "pain" | "number" | "contrast" | "emotion";
  openingMode: "pain_question" | "conclusion" | "scene";
  bodySkeleton: "dry_goods" | "story_seed" | "checklist";
  ctaTypes: Array<"interact" | "save" | "convert" | "follow">;
  tagsMode: "vertical10" | "broad5" | "none" | "balanced";
  complianceMode: "strict" | "standard";
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
  coverHook?: string;
  opening30?: string;
  theme: string;
  body: string;
  tags: string[];
  interaction: string;
  coverSuggestions: string[];
  compliance?: SocialPublishCompliance;
};

export type SocialPublishMpDraft = {
  platform: "wechat_mp";
  title: string;
  digest: string;
  body: string;
  cta: string;
  compliance?: SocialPublishCompliance;
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
