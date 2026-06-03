import type { HomeComposerFormat } from "./homeComposerTypes";
import type { ComposerExpertSelection, PlatformExpertId } from "./homeComposerExpertTypes";

export const EXPERT_DISPLAY_NAMES: Record<PlatformExpertId, string> = {
  xhs_ops: "红书搭子",
  mp_ops: "公号笔杆子",
  voice_gen: "口播编剧",
  podcast_plan: "播客主理"
};

export type ComposerExpertOption = {
  id: PlatformExpertId | "none";
  name: string;
  description: string;
  examples?: string[];
};

export const COMPOSER_EXPERT_OPTIONS: ComposerExpertOption[] = [
  {
    id: "none",
    name: "不选 · 自由问答",
    description: "聊天解惑，不生成发布包"
  },
  {
    id: "xhs_ops",
    name: "红书搭子",
    description: "笔记全流程：图·标题·正文·发布·互动·复盘",
    examples: [
      "把产品复盘写成可发的小红书，要 3 个标题",
      "基于资料写清单体笔记，面向新人",
      "口语一点，带话题 tag"
    ]
  },
  {
    id: "mp_ops",
    name: "公号笔杆子",
    description: "长文全流程：结构·摘要·排版·转发·留言·复盘",
    examples: [
      "写成可转发的公众号长文，带摘要",
      "教程体，小标题清晰",
      "观点文，开头要钩子"
    ]
  },
  {
    id: "voice_gen",
    name: "口播编剧",
    description: "短视频全流程：脚本·封面·发布文案·评论·数据",
    examples: ["60 秒口播，抖音，开头抓人", "分镜稿，结尾引导关注", "把资料缩成 45 秒脚本"]
  },
  {
    id: "podcast_plan",
    name: "播客主理",
    description: "节目全流程：大纲·shownotes·分发·互动·复盘",
    examples: ["3 分钟单人提纲", "双人对话大纲，有观点冲突", "完整脚本节选 + shownotes"]
  }
];

const FORMAT_TO_EXPERT: Record<HomeComposerFormat, PlatformExpertId> = {
  xhs: "xhs_ops",
  mp: "mp_ops",
  voice: "voice_gen",
  podcast: "podcast_plan"
};

const EXPERT_TO_FORMAT: Record<PlatformExpertId, HomeComposerFormat> = {
  xhs_ops: "xhs",
  mp_ops: "mp",
  voice_gen: "voice",
  podcast_plan: "podcast"
};

export function defaultComposerExpertSelection(): ComposerExpertSelection {
  return { mode: "none" };
}

export function expertSelectionFromLegacyFormats(formats: HomeComposerFormat[]): ComposerExpertSelection {
  if (formats.length === 1) {
    return { mode: "platform", expertId: FORMAT_TO_EXPERT[formats[0]!] };
  }
  return { mode: "none" };
}

export function expertIdToLegacyFormat(expert: ComposerExpertSelection): HomeComposerFormat | null {
  if (expert.mode !== "platform") return null;
  return EXPERT_TO_FORMAT[expert.expertId] ?? null;
}

export function expertDisplayLabel(expert: ComposerExpertSelection): string {
  if (expert.mode === "none") return "自由问答";
  return EXPERT_DISPLAY_NAMES[expert.expertId];
}

export function findExpertOption(id: PlatformExpertId | "none"): ComposerExpertOption | undefined {
  return COMPOSER_EXPERT_OPTIONS.find((o) => o.id === id);
}

export function resolveActiveFormats(prefs: {
  formats?: HomeComposerFormat[];
  expert?: ComposerExpertSelection;
} | undefined): HomeComposerFormat[] {
  if (!prefs) return [];
  if (prefs.formats?.length) return prefs.formats;
  const legacy = expertIdToLegacyFormat(prefs.expert ?? { mode: "none" });
  return legacy ? [legacy] : [];
}
