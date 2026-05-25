import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";
import type { SocialPublishPlatform, SocialPublishQuickOptions } from "./socialPublishTypes";
import { defaultAdvancedOptions } from "./socialPublishPresets";
import type { SocialPublishAdvancedOptions } from "./socialPublishTypes";

const KEY = "fym_social_publish_prefs_v1";

type StoredPrefs = {
  platform?: SocialPublishPlatform;
  quick?: SocialPublishQuickOptions;
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
  const quick: SocialPublishQuickOptions = {
    intent: parsed.quick?.intent || "dry_goods",
    audience: parsed.quick?.audience || "general",
    length: parsed.quick?.length || "medium"
  };
  return { platform, quick, advanced: defaultAdvancedOptions(platform) };
}

export function saveSocialPublishPrefs(platform: SocialPublishPlatform, quick: SocialPublishQuickOptions): void {
  writeLocalStorageScoped(KEY, JSON.stringify({ platform, quick }));
}
