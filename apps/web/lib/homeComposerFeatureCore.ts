import type { FeatureCore } from "./homeComposerExpertTypes";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";
import { FEATURE_CORE_FIELDS, featureCorePromptLabel } from "./homeComposerPersonalFields";

export { FEATURE_CORE_FIELDS };

export const EMPTY_FEATURE_CORE: FeatureCore = {
  who: "",
  remember: "",
  avoid: ""
};

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

  const whoParts = [profile.professionalMindset.trim(), profile.impressionVsReality.trim()].filter(Boolean);
  if (!base.who.trim() && whoParts.length) {
    base.who = whoParts.join(" · ").slice(0, 120);
  }
  if (!base.remember.trim() && profile.obsessivePassion.trim()) {
    base.remember = profile.obsessivePassion.trim();
  }
  if (!base.avoid.trim()) {
    if (profile.nonConsensusView.trim()) base.avoid = profile.nonConsensusView.trim();
    else if (profile.acceptedImperfection.trim()) base.avoid = profile.acceptedImperfection.trim().slice(0, 120);
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
  return FEATURE_CORE_FIELDS.map(({ key }) => {
    const val = core[key].trim();
    return val ? `${featureCorePromptLabel(key)}：${val}` : "";
  })
    .filter(Boolean)
    .join("\n");
}
