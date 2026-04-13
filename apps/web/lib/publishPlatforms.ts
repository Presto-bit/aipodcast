/**
 * 发布页目标平台：用于切换下方配置区，后续可按平台扩展字段与校验。
 * 当前仅「小宇宙」走 RSS 托管发布；其余为占位，便于产品迭代。
 */

export type PublishPlatformId =
  | "xiaoyuzhou"
  | "ximalaya"
  | "apple_podcasts"
  | "spotify"
  | "google_podcasts"
  | "netease"
  | "qq_music"
  | "generic_rss";

export type PublishPlatformMeta = {
  id: PublishPlatformId;
  /** 列表展示名 */
  label: string;
  /** 是否已接入发布表单与 API */
  available: boolean;
  /** 未接入时的简短说明 */
  comingSoonHint?: string;
};

export const PUBLISH_PLATFORMS: readonly PublishPlatformMeta[] = [
  { id: "xiaoyuzhou", label: "小宇宙", available: true },
  {
    id: "ximalaya",
    label: "喜马拉雅",
    available: false,
    comingSoonHint: "喜马拉雅直连配置规划中；可先通过 RSS 托管在小宇宙发布后，由平台抓取同步。"
  },
  {
    id: "apple_podcasts",
    label: "Apple 播客",
    available: false,
    comingSoonHint: "通常由托管商写入 RSS 后自动分发；此处将补充连接指引。"
  },
  {
    id: "spotify",
    label: "Spotify",
    available: false,
    comingSoonHint: "规划中；多数场景下与 Apple 类似，依赖 RSS 托管。"
  },
  {
    id: "google_podcasts",
    label: "Google 播客",
    available: false,
    comingSoonHint: "规划中。"
  },
  {
    id: "netease",
    label: "网易云音乐",
    available: false,
    comingSoonHint: "规划中。"
  },
  {
    id: "qq_music",
    label: "QQ 音乐",
    available: false,
    comingSoonHint: "规划中。"
  },
  {
    id: "generic_rss",
    label: "通用 RSS",
    available: false,
    comingSoonHint: "与当前小宇宙流程相同（均为 RSS item）；后续可拆分为独立托管商模板。"
  }
] as const;

export const DEFAULT_PUBLISH_PLATFORM_ID: PublishPlatformId = "xiaoyuzhou";

export function getPublishPlatformMeta(id: PublishPlatformId): PublishPlatformMeta | undefined {
  return PUBLISH_PLATFORMS.find((p) => p.id === id);
}
