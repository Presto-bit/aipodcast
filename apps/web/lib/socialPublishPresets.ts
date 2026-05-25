import type {
  SocialPublishAdvancedOptions,
  SocialPublishIntent,
  SocialPublishPersonaOptions,
  SocialPublishPlatform,
  SocialPublishQuickOptions,
  SocialPublishTargetCharsPreset,
  SocialPublishTargetGender,
  SocialPublishTargetAge,
  SocialPublishTargetRegion,
  SocialPublishTargetOccupation,
  SocialPublishWriterVoice
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

export const SOCIAL_PUBLISH_TARGET_GENDER: { id: SocialPublishTargetGender; label: string }[] = [
  { id: "female", label: "女性" },
  { id: "male", label: "男性" },
  { id: "any", label: "不限" }
];

export const SOCIAL_PUBLISH_TARGET_AGE: { id: SocialPublishTargetAge; label: string }[] = [
  { id: "18_24", label: "18–24 岁" },
  { id: "25_34", label: "25–34 岁" },
  { id: "35_44", label: "35–44 岁" },
  { id: "45_plus", label: "45 岁+" },
  { id: "all_ages", label: "全年龄" }
];

export const SOCIAL_PUBLISH_TARGET_REGION: { id: SocialPublishTargetRegion; label: string }[] = [
  { id: "tier1", label: "一线" },
  { id: "tier2", label: "二线" },
  { id: "tier3_down", label: "三四线及以下" },
  { id: "any", label: "不限" }
];

export const SOCIAL_PUBLISH_TARGET_OCCUPATION: { id: SocialPublishTargetOccupation; label: string }[] = [
  { id: "office_worker", label: "上班族" },
  { id: "student", label: "学生" },
  { id: "parent", label: "宝妈/宝爸" },
  { id: "freelancer", label: "自由职业" },
  { id: "entrepreneur", label: "创业者" },
  { id: "creator", label: "自媒体/创作者" },
  { id: "custom", label: "其他" }
];

export const SOCIAL_PUBLISH_WRITER_VOICE: { id: SocialPublishWriterVoice; label: string; hint: string }[] = [
  { id: "bestie_brother", label: "贴心闺蜜/兄弟型", hint: "口语亲切、像朋友安利" },
  { id: "expert_scholar", label: "行业专家/斜杠学霸", hint: "有观点、有结构、可信" },
  { id: "growth_companion", label: "养成系/真实陪伴", hint: "过程感、真诚克制" },
  { id: "sharp_truth", label: "毒舌人间清醒", hint: "直给结论、反套路" }
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
    gender: "female",
    ageRange: "25_34",
    region: "tier1",
    occupation: "office_worker",
    occupationCustom: "",
    writerVoice: "bestie_brother",
    otherRequirements: ""
  };
}

export function occupationLabel(persona: SocialPublishPersonaOptions): string {
  if (persona.occupation === "custom") {
    return persona.occupationCustom.trim() || "其他职业";
  }
  return SOCIAL_PUBLISH_TARGET_OCCUPATION.find((o) => o.id === persona.occupation)?.label || persona.occupation;
}

export function isXhsPersonaValid(persona: SocialPublishPersonaOptions): boolean {
  if (persona.occupation === "custom") {
    return persona.occupationCustom.trim().length >= 2;
  }
  return Boolean(persona.occupation);
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
    userNote:
      platform === "xiaohongshu" && persona
        ? persona.otherRequirements.trim()
        : advanced.userNote.trim(),
    persona:
      platform === "xiaohongshu" && persona
        ? {
            gender: persona.gender,
            ageRange: persona.ageRange,
            region: persona.region,
            occupation: persona.occupation,
            occupationLabel: occupationLabel(persona),
            occupationCustom:
              persona.occupation === "custom" ? persona.occupationCustom.trim() : "",
            writerVoice: persona.writerVoice,
            otherRequirements: persona.otherRequirements.trim()
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
