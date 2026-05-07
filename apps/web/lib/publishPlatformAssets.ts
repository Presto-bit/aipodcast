import type { PublishPlatformId } from "./publishPlatforms";

/**
 * 平台品牌图（外链）；加载失败时组件应降级为文字。
 * 小宇宙：官网静态资源；喜马拉雅：站点 favicon（后续可换高清 App 图标）。
 */
export const PUBLISH_PLATFORM_ICON_URL: Partial<Record<PublishPlatformId, string>> = {
  xiaoyuzhou: "https://static.xiaoyuzhoufm.com/cosmos/_next/static/media/app.d19d18a4.png",
  ximalaya: "https://www.ximalaya.com/favicon.ico"
};
