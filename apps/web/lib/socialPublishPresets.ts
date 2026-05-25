import type {
  SocialPublishAdvancedOptions,
  SocialPublishAnxiety,
  SocialPublishIntent,
  SocialPublishPersonaCrowd,
  SocialPublishPersonaOptions,
  SocialPublishPlatform,
  SocialPublishQuickOptions,
  SocialPublishTargetCharsPreset
} from "./socialPublishTypes";

export const SOCIAL_TARGET_CHARS_MIN = 100;
export const SOCIAL_TARGET_CHARS_MAX = 5000;

export const SOCIAL_PUBLISH_CHARS_PRESETS: {
  id: SocialPublishTargetCharsPreset;
  label: string;
  chars: number;
}[] = [
  { id: "c400", label: "400 字", chars: 400 },
  { id: "c600", label: "600 字", chars: 600 },
  { id: "c1000", label: "1000 字", chars: 1000 },
  { id: "c1500", label: "1500 字", chars: 1500 },
  { id: "custom", label: "自定义", chars: 0 }
];

export const SOCIAL_PUBLISH_INTENT_OPTIONS: { id: SocialPublishIntent; label: string }[] = [
  { id: "zhongcao", label: "种草" },
  { id: "dry_goods", label: "干货" },
  { id: "opinion", label: "观点" },
  { id: "checklist", label: "清单" },
  { id: "story", label: "故事" }
];

export const SOCIAL_PUBLISH_AUDIENCE_OPTIONS = [
  { id: "beginner" as const, label: "入门" },
  { id: "general" as const, label: "一般" },
  { id: "pro" as const, label: "专业" }
];

export const SOCIAL_PUBLISH_PERSONA_CROWD: { id: SocialPublishPersonaCrowd; label: string }[] = [
  { id: "office_worker", label: "打工人" },
  { id: "student", label: "学生党" },
  { id: "refined_mom", label: "精致妈妈" },
  { id: "mom_baby", label: "宝妈" },
  { id: "ingredient", label: "成分党" },
  { id: "beauty_lover", label: "爱美党" },
  { id: "sensitive_skin", label: "敏感肌" },
  { id: "night_owl", label: "熬夜党" },
  { id: "fitness", label: "健身减脂" },
  { id: "foodie", label: "美食探店" },
  { id: "traveler", label: "旅行党" },
  { id: "digital_geek", label: "数码党" },
  { id: "gen_z", label: "Z 世代" },
  { id: "career_starter", label: "职场新人" },
  { id: "pet_owner", label: "铲屎官" },
  { id: "home_renovator", label: "家装党" },
  { id: "renter", label: "租房党" },
  { id: "wedding_prep", label: "备婚族" },
  { id: "male_grooming", label: "男士理容" },
  { id: "silver_gen", label: "银发族" },
  { id: "custom", label: "自定义" }
];

export const SOCIAL_PUBLISH_PERSONA_CROWD_MAX = 3;

export const SOCIAL_PUBLISH_ANXIETY_OPTIONS: { id: SocialPublishAnxiety; label: string }[] = [
  { id: "waste_money", label: "怕踩雷" },
  { id: "harm", label: "怕伤身" },
  { id: "no_time", label: "没时间" },
  { id: "info_overload", label: "信息太多" },
  { id: "appearance", label: "颜值焦虑" },
  { id: "social", label: "社交尴尬" },
  { id: "uncertain", label: "效果不确定" }
];

export function defaultTargetCharsForPlatform(platform: SocialPublishPlatform): number {
  return platform === "wechat_mp" ? 1500 : 600;
}

export function defaultQuickOptions(platform: SocialPublishPlatform): SocialPublishQuickOptions {
  const chars = defaultTargetCharsForPlatform(platform);
  const preset =
    SOCIAL_PUBLISH_CHARS_PRESETS.find((p) => p.chars === chars)?.id ??
    (platform === "wechat_mp" ? "c1500" : "c600");
  return {
    intent: "dry_goods",
    audience: "general",
    targetCharsPreset: preset,
    targetChars: chars
  };
}

export function clampTargetChars(n: number): number {
  if (!Number.isFinite(n)) return 600;
  return Math.min(SOCIAL_TARGET_CHARS_MAX, Math.max(SOCIAL_TARGET_CHARS_MIN, Math.round(n)));
}

export function charsFromPreset(preset: SocialPublishTargetCharsPreset, customChars: number): number {
  if (preset === "custom") return clampTargetChars(customChars);
  const row = SOCIAL_PUBLISH_CHARS_PRESETS.find((p) => p.id === preset);
  return row?.chars ? clampTargetChars(row.chars) : 600;
}

export function defaultPersonaOptions(): SocialPublishPersonaOptions {
  return {
    crowds: ["office_worker"],
    crowdCustom: "",
    anxieties: ["waste_money"],
    keywords: []
  };
}

export function personaCrowdLabels(persona: SocialPublishPersonaOptions): string[] {
  return persona.crowds.map((id) => {
    if (id === "custom") return persona.crowdCustom.trim() || "自定义人群";
    return SOCIAL_PUBLISH_PERSONA_CROWD.find((c) => c.id === id)?.label || id;
  });
}

export function defaultAdvancedOptions(platform: SocialPublishPlatform): SocialPublishAdvancedOptions {
  return {
    tone: "casual",
    mustInclude: ["bullets", "cta"],
    avoid: [],
    userNote: "",
    useRecommendedBundle: true,
    noteForm: "image_text",
    emojiLevel: "medium",
    interaction: "collect",
    wantTitleOptions: true,
    wantCoverSuggestions: true,
    coverHookStyle: "pain",
    openingMode: "pain_question",
    bodySkeleton: "dry_goods",
    ctaTypes: ["interact", "save"],
    tagsMode: "balanced",
    complianceMode: "strict",
    mpArticleType: "headline",
    mpStructure: "intro_sections",
    wantDigest: true,
    mpCta: platform === "wechat_mp" ? ["source_note"] : []
  };
}

export function buildOptionsPayload(
  quick: SocialPublishQuickOptions,
  advanced: SocialPublishAdvancedOptions,
  persona: SocialPublishPersonaOptions | null,
  platform: SocialPublishPlatform
): Record<string, unknown> {
  const targetChars = clampTargetChars(quick.targetChars);

  return {
    intent: quick.intent,
    audience: quick.audience,
    target_chars: targetChars,
    tone: advanced.tone,
    userNote: advanced.userNote.trim(),
    persona:
      platform === "xiaohongshu" && persona && persona.crowds.length
        ? {
            crowds: persona.crowds,
            crowdLabels: personaCrowdLabels(persona),
            crowdCustom: persona.crowds.includes("custom") ? persona.crowdCustom.trim() : "",
            anxieties: persona.anxieties,
            keywords: persona.keywords
          }
        : undefined,
    extras: {
      mustInclude: advanced.mustInclude,
      avoid: advanced.avoid,
      noteForm: advanced.noteForm,
      emojiLevel: advanced.emojiLevel,
      interaction: advanced.interaction,
      wantTitleOptions: advanced.wantTitleOptions,
      tagsMode: advanced.tagsMode,
      wantCoverSuggestions: advanced.wantCoverSuggestions,
      coverHookStyle: advanced.coverHookStyle,
      openingMode: advanced.openingMode,
      bodySkeleton: advanced.bodySkeleton,
      ctaTypes: advanced.ctaTypes,
      complianceMode: advanced.complianceMode,
      mpArticleType: advanced.mpArticleType,
      mpStructure: advanced.mpStructure,
      wantDigest: advanced.wantDigest,
      mpCta: advanced.mpCta
    }
  };
}

export function platformLabel(platform: SocialPublishPlatform): string {
  return platform === "xiaohongshu" ? "小红书" : "微信公众号";
}
