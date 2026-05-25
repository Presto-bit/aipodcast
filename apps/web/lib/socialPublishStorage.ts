import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";
import type { SocialPublishPlatform, SocialPublishQuickOptions } from "./socialPublishTypes";
import { defaultAdvancedOptions, defaultQuickOptions, clampTargetChars } from "./socialPublishPresets";
import type { SocialPublishAdvancedOptions } from "./socialPublishTypes";

const KEY = "fym_social_publish_prefs_v1";

type StoredPrefs = {
  platform?: SocialPublishPlatform;
  quick?: Partial<SocialPublishQuickOptions> & { length?: string };
};

export function loadSocialPublishPrefs(): {
  platform: SocialPublishPlatform;
  quick: SocialPublishQuickOptions;
  advanced: SocialPublishAdvancedOptions;
} {
  const raw = readLocalStorageScoped(KEY);
  let parsed: StoredPrefs = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as StoredPrefs;
    } catch {
      parsed = {};
    }
  }
  const platform =
    parsed.platform === "wechat_mp" || parsed.platform === "xiaohongshu" ? parsed.platform : "xiaohongshu";
  const base = defaultQuickOptions(platform);
  const q = parsed.quick;
  let targetChars = base.targetChars;
  if (q && typeof q.targetChars === "number") {
    targetChars = clampTargetChars(q.targetChars);
  } else if (q?.length === "short") targetChars = 400;
  else if (q?.length === "long") targetChars = 1500;
  const preset =
    q?.targetCharsPreset && q.targetCharsPreset !== "custom"
      ? q.targetCharsPreset
      : base.targetCharsPreset;
  const quick: SocialPublishQuickOptions = {
    intent: q?.intent || base.intent,
    audience: q?.audience || base.audience,
    targetCharsPreset: q?.targetCharsPreset === "custom" ? "custom" : preset,
    targetChars
  };
  return { platform, quick, advanced: defaultAdvancedOptions(platform) };
}

export function saveSocialPublishPrefs(platform: SocialPublishPlatform, quick: SocialPublishQuickOptions): void {
  writeLocalStorageScoped(KEY, JSON.stringify({ platform, quick }));
}
