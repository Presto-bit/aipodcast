import type {
  SocialPublishAdvancedOptions,
  SocialPublishInterest,
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

export const SOCIAL_TARGET_CHARS_MIN = 200;
export const SOCIAL_TARGET_CHARS_MAX = 5000;

export const SOCIAL_PUBLISH_CHARS_PRESETS: {
  id: SocialPublishTargetCharsPreset;
  label: string;
  chars: number;
}[] = [
  { id: "c200", label: "200 字", chars: 200 },
  { id: "c400", label: "400 字", chars: 400 },
  { id: "c600", label: "600 字", chars: 600 },
  { id: "c1000", label: "1000 字", chars: 1000 },
  { id: "c1500", label: "1500 字", chars: 1500 },
  { id: "custom", label: "自定义", chars: 0 }
];

const GENDERS: { id: SocialPublishTargetGender; label: string }[] = [
  { id: "female", label: "女性" },
  { id: "male", label: "男性" },
  { id: "any", label: "不限" }
];

const AGES: { id: SocialPublishTargetAge; label: string }[] = [
  { id: "18_24", label: "18–24 岁" },
  { id: "25_34", label: "25–34 岁" },
  { id: "35_44", label: "35–44 岁" },
  { id: "45_plus", label: "45 岁+" },
  { id: "all_ages", label: "全年龄" }
];

const REGIONS: { id: SocialPublishTargetRegion; label: string }[] = [
  { id: "tier1", label: "一线" },
  { id: "tier2", label: "二线" },
  { id: "tier3_down", label: "三四线及以下" },
  { id: "any", label: "不限" }
];

export const SOCIAL_PUBLISH_INTERESTS: { id: SocialPublishInterest; label: string }[] = [
  { id: "beauty", label: "美妆护肤" },
  { id: "fashion", label: "穿搭" },
  { id: "food", label: "美食" },
  { id: "travel", label: "旅行" },
  { id: "fitness", label: "健身运动" },
  { id: "home", label: "家居生活" },
  { id: "tech", label: "数码科技" },
  { id: "career", label: "职场成长" },
  { id: "study", label: "读书学习" },
  { id: "parenting", label: "母婴育儿" },
  { id: "pets", label: "萌宠" },
  { id: "photo", label: "摄影" },
  { id: "coffee", label: "咖啡探店" },
  { id: "entertainment", label: "影视娱乐" },
  { id: "music", label: "音乐" },
  { id: "gaming", label: "游戏" },
  { id: "finance", label: "理财" },
  { id: "emotion", label: "情感" },
  { id: "diy", label: "手工 DIY" },
  { id: "outdoor", label: "户外" }
];

export const SOCIAL_PUBLISH_MP_INTERESTS: { id: SocialPublishInterest; label: string }[] = [
  { id: "biz_finance", label: "财经商业" },
  { id: "tech", label: "科技互联网" },
  { id: "edu_exam", label: "教育考试" },
  { id: "health", label: "健康养生" },
  { id: "lifestyle", label: "生活方式" },
  { id: "news_current", label: "时政资讯" },
  { id: "humanities", label: "人文历史" },
  { id: "career", label: "职场管理" },
  { id: "parenting", label: "亲子教育" },
  { id: "emotion", label: "情感心理" },
  { id: "law", label: "法律普法" },
  { id: "auto", label: "汽车出行" },
  { id: "real_estate", label: "房产置业" },
  { id: "food", label: "美食" },
  { id: "travel", label: "旅行" },
  { id: "study", label: "读书文化" },
  { id: "agri", label: "三农" },
  { id: "entertainment", label: "文娱" }
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

export const SOCIAL_PUBLISH_MP_OCCUPATION: { id: SocialPublishTargetOccupation; label: string }[] = [
  { id: "office_worker", label: "企业白领" },
  { id: "civil_servant", label: "体制内" },
  { id: "teacher", label: "教师/科研" },
  { id: "professional", label: "医生/律师等专业人士" },
  { id: "entrepreneur", label: "企业主/管理者" },
  { id: "student", label: "在校学生" },
  { id: "freelancer", label: "自由职业/撰稿人" },
  { id: "retiree", label: "退休群体" },
  { id: "custom", label: "其他" }
];

export const SOCIAL_PUBLISH_WRITER_VOICE: { id: SocialPublishWriterVoice; label: string; hint: string }[] = [
  { id: "bestie_brother", label: "贴心闺蜜/兄弟型", hint: "口语亲切、像朋友安利" },
  { id: "expert_scholar", label: "行业专家/斜杠学霸", hint: "有观点、有结构、可信" },
  { id: "growth_companion", label: "养成系/真实陪伴", hint: "过程感、真诚克制" },
  { id: "sharp_truth", label: "毒舌人间清醒", hint: "直给结论、反套路" }
];

export const SOCIAL_PUBLISH_MP_WRITER_VOICE: { id: SocialPublishWriterVoice; label: string; hint: string }[] = [
  { id: "official_account", label: "机构/品牌官方", hint: "稳重可信、信息清晰" },
  { id: "insight_column", label: "深度洞察专栏", hint: "有论据、有结构、偏专业" },
  { id: "warm_story", label: "温暖人文叙事", hint: "故事感、共情、可读" },
  { id: "practical_guide", label: "实用攻略体", hint: "步骤清晰、收藏转发向" }
];

export function publishPresetBundle(platform: SocialPublishPlatform) {
  return {
    genders: GENDERS,
    ages: AGES,
    regions: REGIONS,
    interests: platform === "wechat_mp" ? SOCIAL_PUBLISH_MP_INTERESTS : SOCIAL_PUBLISH_INTERESTS,
    occupations:
      platform === "wechat_mp" ? SOCIAL_PUBLISH_MP_OCCUPATION : SOCIAL_PUBLISH_TARGET_OCCUPATION,
    writerVoices:
      platform === "wechat_mp" ? SOCIAL_PUBLISH_MP_WRITER_VOICE : SOCIAL_PUBLISH_WRITER_VOICE
  };
}

export const XHS_TITLE_COUNT = 3;

export function toggleMultiSelect<T extends string>(
  current: T[],
  id: T,
  exclusiveId?: T
): T[] {
  if (exclusiveId && id === exclusiveId) {
    return current.includes(id) ? [] : [exclusiveId];
  }
  let next = exclusiveId ? current.filter((x) => x !== exclusiveId) : [...current];
  if (next.includes(id)) {
    next = next.filter((x) => x !== id);
  } else {
    next = [...next, id];
  }
  return next;
}

/** 性别单选：女/男互斥；「不限」与具体性别互斥，避免空选或矛盾画像。 */
export function toggleSocialGender(
  current: SocialPublishTargetGender[],
  id: SocialPublishTargetGender
): SocialPublishTargetGender[] {
  if (id === "any") {
    return current.includes("any") ? ["female"] : ["any"];
  }
  const withoutAny = current.filter((x) => x !== "any");
  if (withoutAny.includes(id)) {
    const next = withoutAny.filter((x) => x !== id);
    return next.length ? next : ["female"];
  }
  return [id];
}

export function interestLabels(
  persona: SocialPublishPersonaOptions,
  platform: SocialPublishPlatform
): string[] {
  const list = platform === "wechat_mp" ? SOCIAL_PUBLISH_MP_INTERESTS : SOCIAL_PUBLISH_INTERESTS;
  return persona.interests.map((id) => list.find((o) => o.id === id)?.label || id);
}

export function ensureXhsTitles(titles: string[]): [string, string, string] {
  const base = titles.map((t) => t.trim()).filter(Boolean);
  const out = [...base];
  while (out.length < XHS_TITLE_COUNT) {
    out.push(out[0] || "标题备选");
  }
  return [out[0]!, out[1]!, out[2]!];
}

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

export function defaultPersonaOptions(platform: SocialPublishPlatform): SocialPublishPersonaOptions {
  return {
    genders: ["female"],
    ageRanges: ["25_34"],
    regions: ["tier1"],
    interests: [],
    occupations: ["office_worker"],
    occupationCustom: "",
    writerVoice: null,
    otherRequirements: ""
  };
}

export function occupationLabels(
  persona: SocialPublishPersonaOptions,
  platform: SocialPublishPlatform
): string[] {
  const list =
    platform === "wechat_mp" ? SOCIAL_PUBLISH_MP_OCCUPATION : SOCIAL_PUBLISH_TARGET_OCCUPATION;
  return persona.occupations.flatMap((id) => {
    if (id === "custom") {
      const c = persona.occupationCustom.trim();
      return c ? [c] : [];
    }
    const row = list.find((o) => o.id === id);
    return row ? [row.label] : [];
  });
}

export function isPersonaValid(persona: SocialPublishPersonaOptions): boolean {
  if (
    !persona.genders.length ||
    !persona.ageRanges.length ||
    !persona.regions.length ||
    !persona.occupations.length
  ) {
    return false;
  }
  if (persona.occupations.includes("custom") && persona.occupationCustom.trim().length < 2) {
    return false;
  }
  return true;
}

/** @deprecated 使用 isPersonaValid */
export const isXhsPersonaValid = isPersonaValid;

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
    platform,
    intent: quick.intent,
    audience: quick.audience,
    target_chars: targetChars,
    tone: advanced.tone,
    userNote: persona ? persona.otherRequirements.trim() : advanced.userNote.trim(),
    persona: persona
      ? {
          genders: persona.genders,
          ageRanges: persona.ageRanges,
          regions: persona.regions,
          interests: persona.interests,
          interestLabels: interestLabels(persona, platform),
          occupations: persona.occupations,
          occupationLabels: occupationLabels(persona, platform),
          occupationCustom: persona.occupations.includes("custom")
            ? persona.occupationCustom.trim()
            : "",
          writerVoice: persona.writerVoice || "",
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
