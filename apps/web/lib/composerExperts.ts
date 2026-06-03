import type { HomeComposerFormat } from "./homeComposerTypes";
import type { ComposerExpertSelection, PlatformExpertId } from "./homeComposerExpertTypes";

export const EXPERT_DISPLAY_NAMES: Record<PlatformExpertId, string> = {
  xhs_ops: "小红书运营专家",
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

/** 首页专家下拉可选项（P0 仅小红书；再次点击已选项可取消） */
export const COMPOSER_EXPERT_OPTIONS: ComposerExpertOption[] = [
  {
    id: "xhs_ops",
    name: "小红书运营专家",
    description: "笔记全流程：标题·正文·话题·发布清单",
    examples: [
      "把产品复盘写成可发的小红书，要 3 个标题",
      "基于资料写清单体笔记，面向新人",
      "口语一点，带话题 tag"
    ]
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
  if (expert.mode === "none") return "";
  return EXPERT_DISPLAY_NAMES[expert.expertId];
}

export function findExpertOption(id: PlatformExpertId | "none"): ComposerExpertOption | undefined {
  return COMPOSER_EXPERT_OPTIONS.find((o) => o.id === id);
}

/** P0 已接通生成 Job 的专家；其余可选但确认页会提示即将上线 */
export const EXPERT_DELIVERABLE_READY: Record<PlatformExpertId, boolean> = {
  xhs_ops: true,
  mp_ops: false,
  voice_gen: false,
  podcast_plan: false
};

export function resolveActiveFormats(prefs: {
  formats?: HomeComposerFormat[];
  expert?: ComposerExpertSelection;
} | undefined): HomeComposerFormat[] {
  if (!prefs) return [];
  if (prefs.formats?.length) return prefs.formats;
  const legacy = expertIdToLegacyFormat(prefs.expert ?? { mode: "none" });
  return legacy ? [legacy] : [];
}
