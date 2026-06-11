import type { StudioDomain, StudioFormat } from "./studioDomainProfile";
import type { StudioExplicitGoal } from "./studioExplicitGoal";
import { normalizeStudioComposeBrief } from "./studioComposeBrief";
import type { StudioWork } from "./studioWorkTypes";

export type StudioSceneChipId = "science_article" | "social_seed";

export type StudioSceneChip = {
  id: StudioSceneChipId;
  label: string;
  brief?: string;
  domain?: StudioDomain;
  format?: StudioFormat;
  explicitGoal?: StudioExplicitGoal;
  placeholder?: string;
};

/** New Agent 空会话：仅科普 / 种草 */
export const STUDIO_NEW_AGENT_SCENE_CHIPS: StudioSceneChip[] = [
  {
    id: "science_article",
    label: "科普长文",
    brief: "写一篇科普长文，约 2000 字，结构清晰、论据准确",
    domain: "article",
    format: "long_form",
    placeholder: "补充主题，例如：AI 安全与对齐"
  },
  {
    id: "social_seed",
    label: "种草笔记",
    brief: "写一篇小红书种草笔记，突出一个差异化卖点",
    domain: "social",
    format: "short_post",
    placeholder: "补充产品或主题"
  }
];

/** 点击场景 chip：合并 brief / domain / format / explicitGoal（不覆盖已有 brief） */
export function applySceneChip(work: StudioWork, chip: StudioSceneChip): StudioWork {
  const next: StudioWork = { ...work, updatedAt: Date.now() };
  if (chip.domain) next.domain = chip.domain;
  if (chip.format) next.format = chip.format;
  if (chip.explicitGoal) next.explicitGoal = chip.explicitGoal;
  if (chip.brief && !work.brief.trim()) {
    next.brief = normalizeStudioComposeBrief(chip.brief);
  }
  return next;
}

export function sceneChipPlaceholder(chip: StudioSceneChip): string {
  return chip.placeholder?.trim() || "描述想写什么…";
}
