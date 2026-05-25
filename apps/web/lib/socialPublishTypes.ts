export type SocialPublishPlatform = "xiaohongshu" | "wechat_mp";

export type SocialPublishTargetCharsPreset = "c200" | "c400" | "c600" | "c1000" | "c1500" | "custom";

export type SocialPublishSourceType = "ask_answer" | "notes_only";

/** 目标人群定位（两平台共用维度） */
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
  | "civil_servant"
  | "teacher"
  | "professional"
  | "retiree"
  | "custom";

export type SocialPublishWriterVoice =
  | "bestie_brother"
  | "expert_scholar"
  | "growth_companion"
  | "sharp_truth"
  | "official_account"
  | "insight_column"
  | "warm_story"
  | "practical_guide";

export type SocialPublishInterest =
  | "beauty"
  | "fashion"
  | "food"
  | "travel"
  | "fitness"
  | "home"
  | "tech"
  | "career"
  | "study"
  | "parenting"
  | "pets"
  | "photo"
  | "coffee"
  | "entertainment"
  | "music"
  | "gaming"
  | "finance"
  | "emotion"
  | "diy"
  | "outdoor"
  | "biz_finance"
  | "edu_exam"
  | "health"
  | "lifestyle"
  | "news_current"
  | "humanities"
  | "law"
  | "auto"
  | "real_estate"
  | "agri";

export type SocialPublishPersonaOptions = {
  genders: SocialPublishTargetGender[];
  ageRanges: SocialPublishTargetAge[];
  regions: SocialPublishTargetRegion[];
  interests: SocialPublishInterest[];
  occupations: SocialPublishTargetOccupation[];
  occupationCustom: string;
  /** 可不选；未选时由模型按素材推断口吻 */
  writerVoice: SocialPublishWriterVoice | null;
  otherRequirements: string;
};

export type SocialPublishCompliance = {
  status: "passed" | "auto_softened";
  hitCount: number;
  categories: string[];
  userMessage: string;
};

export type SocialPublishWizardStep = "platform" | "options" | "source" | "generating" | "result";

/** @deprecated 保留类型兼容；选项页已不再使用 */
export type SocialPublishQuickOptions = {
  intent: string;
  audience: string;
  targetCharsPreset: SocialPublishTargetCharsPreset;
  targetChars: number;
};

export type SocialPublishAdvancedOptions = {
  tone: string;
  mustInclude: string[];
  avoid: string[];
  userNote: string;
  useRecommendedBundle: boolean;
  noteForm: string;
  emojiLevel: "rich" | "medium" | "none";
  interaction: string;
  wantTitleOptions: boolean;
  wantCoverSuggestions: boolean;
  coverHookStyle: string;
  openingMode: string;
  bodySkeleton: string;
  ctaTypes: string[];
  tagsMode: string;
  complianceMode: string;
  mpArticleType: string;
  mpStructure: string;
  wantDigest: boolean;
  mpCta: string[];
};

/** 小红书 / 公众号统一发布稿结构 */
export type SocialPublishContentDraft = {
  platform: SocialPublishPlatform;
  titles: [string, string, string];
  selectedTitleIndex: number;
  coverHook?: string;
  opening30?: string;
  theme: string;
  body: string;
  imageSuggestions: string[];
  compliance?: SocialPublishCompliance;
};

export type SocialPublishDraft = SocialPublishContentDraft;

export type SocialPublishSourceCandidate = {
  key: string;
  type: SocialPublishSourceType;
  label: string;
  materialPreview: string;
  materialText: string;
  jobId?: string;
  recommended?: boolean;
};
