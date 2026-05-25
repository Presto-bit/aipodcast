import type {
  SocialPublishAdvancedOptions,
  SocialPublishIntent,
  SocialPublishPlatform,
  SocialPublishQuickOptions
} from "./socialPublishTypes";

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

export const SOCIAL_PUBLISH_LENGTH_OPTIONS = [
  { id: "short" as const, label: "短" },
  { id: "medium" as const, label: "中" },
  { id: "long" as const, label: "长" }
];

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
    tagsMode: "vertical10",
    wantCoverSuggestions: true,
    mpArticleType: "headline",
    mpStructure: "intro_sections",
    wantDigest: true,
    mpCta: platform === "wechat_mp" ? ["source_note"] : []
  };
}

export function buildOptionsPayload(
  quick: SocialPublishQuickOptions,
  advanced: SocialPublishAdvancedOptions
): Record<string, unknown> {
  return {
    intent: quick.intent,
    audience: quick.audience,
    length: quick.length,
    tone: advanced.tone,
    userNote: advanced.userNote.trim(),
    extras: {
      mustInclude: advanced.mustInclude,
      avoid: advanced.avoid,
      noteForm: advanced.noteForm,
      emojiLevel: advanced.emojiLevel,
      interaction: advanced.interaction,
      wantTitleOptions: advanced.wantTitleOptions,
      tagsMode: advanced.tagsMode,
      wantCoverSuggestions: advanced.wantCoverSuggestions,
      mpArticleType: advanced.mpArticleType,
      mpStructure: advanced.mpStructure,
      wantDigest: advanced.wantDigest,
      mpCta: advanced.mpCta
    }
  };
}

export function summarizeWizardIntent(
  platform: SocialPublishPlatform,
  quick: SocialPublishQuickOptions
): string {
  const intent = SOCIAL_PUBLISH_INTENT_OPTIONS.find((x) => x.id === quick.intent)?.label || "干货";
  const aud = SOCIAL_PUBLISH_AUDIENCE_OPTIONS.find((x) => x.id === quick.audience)?.label || "一般";
  const len = SOCIAL_PUBLISH_LENGTH_OPTIONS.find((x) => x.id === quick.length)?.label || "中";
  const plat = platform === "xiaohongshu" ? "小红书" : "微信公众号";
  return `${plat} · ${intent} · 写给${aud} · ${len}篇`;
}

export function platformLabel(platform: SocialPublishPlatform): string {
  return platform === "xiaohongshu" ? "小红书" : "微信公众号";
}
