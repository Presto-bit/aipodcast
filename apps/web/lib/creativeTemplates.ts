/**
 * 「创作模板」与「加入创意」参数（脚本风格、人设、约束）的解析与应用。
 */
import { DEFAULT_SCRIPT_CONSTRAINTS, formatScriptStyleChip } from "./podcastStudioCommon";
import { PODCAST_STUDIO_PRESETS, type PodcastStudioPreset } from "./podcastStudioPresets";
import { listUserTemplates } from "./userTemplates";

export const DEFAULT_CREATIVE_SCRIPT_STYLE = "轻松幽默，自然流畅";
export const DEFAULT_CREATIVE_SPEAKER1 = "活泼亲切，引导话题";
export const DEFAULT_CREATIVE_SPEAKER2 = "稳重专业，深度分析";

/** 系统自带的「默认创意模板」，所有用户可见；与自定义模板（仅本人）区分。 */
const BUILTIN_CREATIVE_BALANCED: PodcastStudioPreset = {
  id: "creative_default_balanced",
  label: "通用平衡",
  description: "站点默认双人播客创意：结构清晰、语速自然，适合多数素材。",
  textPrefix: "",
  scriptStyle: DEFAULT_CREATIVE_SCRIPT_STYLE,
  speaker1Persona: DEFAULT_CREATIVE_SPEAKER1,
  speaker2Persona: DEFAULT_CREATIVE_SPEAKER2,
  scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
};

/** 内置创意模板顺序：默认一项 + 四种结构化风格（与主素材 textPrefix 一致，仅用于加入创意时同样生效）。 */
export const BUILTIN_CREATIVE_PRESETS: PodcastStudioPreset[] = [BUILTIN_CREATIVE_BALANCED, ...PODCAST_STUDIO_PRESETS];

/** AI/笔记播客页「加入创意」的默认选项 */
export const DEFAULT_CREATIVE_TEMPLATE_VALUE = `sys:${BUILTIN_CREATIVE_BALANCED.id}`;

export const CREATIVE_TEMPLATE_GROUP_BUILTIN = "默认创意模板";
export const CREATIVE_TEMPLATE_GROUP_USER = "自定义创意模板";

export type CreativeTemplateSelectOption = {
  value: string;
  label: string;
  group: string;
  prefix: string;
};

/**
 * 加入创意下拉的选项：先系统默认，再当前用户的自定义（本地 + 登录后服务端同步）。
 */
export function mergeCreativeTemplateSelectOptions(): CreativeTemplateSelectOption[] {
  const out: CreativeTemplateSelectOption[] = [];
  for (const p of BUILTIN_CREATIVE_PRESETS) {
    out.push({
      value: `sys:${p.id}`,
      label: p.label,
      group: CREATIVE_TEMPLATE_GROUP_BUILTIN,
      prefix: p.textPrefix
    });
  }
  const userCreative = listUserTemplates().filter((t) => (t.category || "").trim() === "加入创意");
  for (const p of userCreative) {
    out.push({
      value: `usr:${p.id}`,
      label: p.label,
      group: CREATIVE_TEMPLATE_GROUP_USER,
      prefix: p.textPrefix
    });
  }
  return out;
}

export type CreativeBundle = {
  scriptStyle: string;
  speaker1Persona: string;
  speaker2Persona: string;
  scriptConstraints: string;
};

function resolveScriptConstraints(p: PodcastStudioPreset): string {
  const explicit = p.scriptConstraints?.trim();
  if (explicit) return explicit;
  const tp = p.textPrefix?.trim();
  if (tp) return `${DEFAULT_SCRIPT_CONSTRAINTS}\n\n${tp}`;
  return DEFAULT_SCRIPT_CONSTRAINTS;
}

/**
 * 从一条模板记录得到加入创意四元组；缺省字段用站点默认。
 */
export function creativeBundleFromPreset(p: PodcastStudioPreset): CreativeBundle {
  return {
    scriptStyle: (p.scriptStyle?.trim() && p.scriptStyle) || DEFAULT_CREATIVE_SCRIPT_STYLE,
    speaker1Persona: (p.speaker1Persona?.trim() && p.speaker1Persona) || DEFAULT_CREATIVE_SPEAKER1,
    speaker2Persona: (p.speaker2Persona?.trim() && p.speaker2Persona) || DEFAULT_CREATIVE_SPEAKER2,
    scriptConstraints: resolveScriptConstraints(p)
  };
}

/**
 * @param value mergePresetOptions 风格的 id：`sys:<presetId>` 或 `usr:<userTemplateId>`
 */
export function creativeBundleFromTemplateValue(value: string): CreativeBundle | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("sys:")) {
    const id = v.slice(4);
    const p = BUILTIN_CREATIVE_PRESETS.find((x) => x.id === id);
    return p ? creativeBundleFromPreset(p) : null;
  }
  if (v.startsWith("usr:")) {
    const id = v.slice(4);
    const u = listUserTemplates().find((x) => x.id === id);
    return u ? creativeBundleFromPreset(u) : null;
  }
  return null;
}

/** 解析失败（如自定义已删）时回退为站点默认「通用平衡」Bundle。 */
export function resolveCreativeBundle(templateValue: string): CreativeBundle {
  return creativeBundleFromTemplateValue(templateValue) ?? creativeBundleFromPreset(BUILTIN_CREATIVE_BALANCED);
}

/** 工具栏芯片等展示用：方案标题（内置 / 自定义）。 */
export function labelForCreativeTemplateValue(value: string): string {
  const v = value.trim();
  if (v.startsWith("sys:")) {
    const id = v.slice(4);
    const p = BUILTIN_CREATIVE_PRESETS.find((x) => x.id === id);
    if (p) return p.label;
  }
  if (v.startsWith("usr:")) {
    const id = v.slice(4);
    const u = listUserTemplates().find((x) => x.id === id);
    if (u) return u.label;
  }
  return BUILTIN_CREATIVE_BALANCED.label;
}

/** 工具栏「加入创意 · …」芯片：标题短截，避免占满一行。 */
export function formatCreativeTemplateChip(templateValue: string, maxChars = 8): string {
  return formatScriptStyleChip(labelForCreativeTemplateValue(templateValue), maxChars);
}
