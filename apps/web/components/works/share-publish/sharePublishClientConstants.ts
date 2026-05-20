import type { PublishPlatformId } from "../../../lib/publishPlatforms";

export const RSS_LAST_CHANNEL_STORAGE_KEY = "fym_rss_last_channel_id";

export const PINNED_PUBLISH_PLATFORM_IDS: PublishPlatformId[] = ["xiaoyuzhou", "ximalaya"];
export const PINNED_PUBLISH_PLATFORM_SET = new Set<PublishPlatformId>(PINNED_PUBLISH_PLATFORM_IDS);

/** 「更多」下拉：仅展示这些占位平台 */
export const MORE_MENU_PUBLISH_PLATFORM_IDS: PublishPlatformId[] = ["apple_podcasts", "netease"];
export const MORE_MENU_PUBLISH_PLATFORM_SET = new Set<PublishPlatformId>(MORE_MENU_PUBLISH_PLATFORM_IDS);

export const DRAFT_DEBOUNCE_MS = 600;
export const JOB_GEN_PLACEHOLDER = "生成中,请稍等...";
export const JOB_GEN_SCRIPT_DRAFT_PLACEHOLDER =
  "文稿排队生成中，通常需数分钟，请勿关闭页面；完成后正文会自动载入。若长时间无进度，可刷新本页。";
