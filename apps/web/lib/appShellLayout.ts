/**
 * AppShell 布局与侧栏持久化（Tailwind 任意宽度需完整字面量以便 JIT 扫描）。
 */

export const ADMIN_ROLE = "admin";

export const SIDEBAR_WIDTH_COLLAPSED_CLASS = "w-[72px]";
export const SIDEBAR_WIDTH_EXPANDED_CLASS = "w-[232px]";

/** 与上列 Tailwind 宽度一致，供写入 `--fym-app-sidebar-w`（`.fym-workspace-scrim` 遮罩左边界） */
export const SIDEBAR_WIDTH_COLLAPSED_PX = 72;
export const SIDEBAR_WIDTH_EXPANDED_PX = 232;
/** 知识库笔记本工作台极简侧栏（仅图标轨） */
export const SIDEBAR_WIDTH_NOTES_WORKBENCH_RAIL_PX = 48;

/** 与 Tailwind `max-lg`（小于 1024px）一致：窄屏下主导航改为抽屉，主区全宽 */
export const APP_SHELL_MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

export const SIDEBAR_COLLAPSED_STORAGE = "1";
export const SIDEBAR_EXPANDED_STORAGE = "0";

export const NAV_SECTION_LABEL_CLASS =
  "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/90";

export const NAV_SECTION_DIVIDER_COLLAPSED_CLASS = "my-0.5 border-t border-line";
