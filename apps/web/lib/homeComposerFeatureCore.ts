import type { FeatureCore } from "./homeComposerExpertTypes";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";

export const EMPTY_FEATURE_CORE: FeatureCore = {
  who: "",
  remember: "",
  avoid: ""
};

export const FEATURE_CORE_FIELDS: {
  key: keyof FeatureCore;
  label: string;
  placeholder: string;
  rows: number;
}[] = [
  {
    key: "who",
    label: "你是谁、常写给谁看？",
    placeholder: "产品经理，写给准备转产品的人",
    rows: 2
  },
  {
    key: "remember",
    label: "你希望读者记住你什么？",
    placeholder: "复盘真实踩坑，不灌鸡汤",
    rows: 2
  },
  {
    key: "avoid",
    label: "千万别写成什么样？",
    placeholder: "绝对化承诺、编造数据",
    rows: 2
  }
];

export function featureCoreComplete(core: FeatureCore | undefined | null): number {
  if (!core) return 0;
  return FEATURE_CORE_FIELDS.filter(({ key }) => core[key].trim()).length;
}

export function isFeatureCoreComplete(core: FeatureCore | undefined | null): boolean {
  return featureCoreComplete(core) === 3;
}

/** 老用户规则反填（§4.4） */
export function backfillFeatureCoreFromProfile(
  core: FeatureCore | undefined | null,
  profile: HomeComposerPersonalProfile | null | undefined
): FeatureCore {
  const base = { ...EMPTY_FEATURE_CORE, ...(core ?? {}) };
  if (!profile) return base;

  const whoParts = [profile.identity.trim(), profile.currentDoing.trim()].filter(Boolean);
  if (!base.who.trim() && whoParts.length) {
    base.who = whoParts.join(" · ").slice(0, 80);
  }
  if (!base.remember.trim() && profile.remember.trim()) {
    base.remember = profile.remember.trim();
  }
  if (!base.avoid.trim()) {
    if (profile.values.trim()) base.avoid = profile.values.trim();
    else if (profile.other.trim()) base.avoid = profile.other.trim().slice(0, 80);
  }
  return base;
}

export function featureCoreStatusSummary(core: FeatureCore | undefined | null): string {
  if (!core) return "";
  const parts = [core.who, core.remember, core.avoid].map((s) => s.trim()).filter(Boolean);
  const joined = parts.join(" · ");
  if (!joined) return "";
  return joined.length > 12 ? `${joined.slice(0, 11)}…` : joined;
}

export function shouldAutoEnablePersonalFeature(
  core: FeatureCore | undefined | null,
  personalDisabledByUser: boolean | undefined
): boolean {
  return isFeatureCoreComplete(core) && !personalDisabledByUser;
}

export function featureCoreToPrompt(core: FeatureCore | undefined | null): string {
  if (!core) return "";
  const lines = [
    core.who.trim() ? `你是谁、常写给谁看：${core.who.trim()}` : "",
    core.remember.trim() ? `希望读者记住：${core.remember.trim()}` : "",
    core.avoid.trim() ? `千万别写成：${core.avoid.trim()}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}
