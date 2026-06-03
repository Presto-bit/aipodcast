import type { FeatureCore, PlatformExpertId } from "./homeComposerExpertTypes";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";
import { isFeatureCoreComplete } from "./homeComposerFeatureCore";

export const FEATURE_NUDGE_SKIP_KEY = "fym_feature_nudge_skip_count";
const EXPERT_EVER_SELECTED_KEY = "fym_composer_expert_ever_selected_v1";

export function getFeatureNudgeSkipCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(FEATURE_NUDGE_SKIP_KEY);
    const n = Number.parseInt(String(raw ?? "0"), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function incrementFeatureNudgeSkipCount(): number {
  const next = getFeatureNudgeSkipCount() + 1;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(FEATURE_NUDGE_SKIP_KEY, String(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function getExpertEverSelected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(EXPERT_EVER_SELECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markExpertEverSelected(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EXPERT_EVER_SELECTED_KEY, "1");
  } catch {
    // ignore
  }
}

export function hasPersonalProfileContent(profile: HomeComposerPersonalProfile | null | undefined): boolean {
  if (!profile) return false;
  return Object.values(profile).some((v) => String(v ?? "").trim().length > 0);
}

export function shouldShowFeatureNudge(params: {
  isFirstExpertSelect: boolean;
  featureCore: FeatureCore | undefined | null;
  personalEnabled: boolean;
  personalProfile: HomeComposerPersonalProfile | null | undefined;
  skipCount?: number;
}): boolean {
  if (!params.isFirstExpertSelect) return false;
  if (isFeatureCoreComplete(params.featureCore)) return false;
  if (params.personalEnabled && hasPersonalProfileContent(params.personalProfile)) return false;
  const skip = params.skipCount ?? getFeatureNudgeSkipCount();
  if (skip >= 3) return false;
  return true;
}

export function xhsFeatureNudgeHint(expertId: PlatformExpertId | null | undefined): string | null {
  return expertId === "xhs_ops" ? "笔记要带「你是谁」才像真人号，不是纯营销号。" : null;
}
