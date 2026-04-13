/**
 * AppShell 布局与侧栏持久化（Tailwind 任意宽度需完整字面量以便 JIT 扫描）。
 */

export const ADMIN_ROLE = "admin";

export const SIDEBAR_WIDTH_COLLAPSED_CLASS = "w-[72px]";
export const SIDEBAR_WIDTH_EXPANDED_CLASS = "w-[232px]";

export const SIDEBAR_COLLAPSED_STORAGE = "1";
export const SIDEBAR_EXPANDED_STORAGE = "0";

export const NAV_SCROLL_MAX_HEIGHT = "min(calc(100dvh - 15rem), 28rem)";

export const FOOTER_LINK_CLASS = "text-brand hover:underline";

export const NAV_SECTION_LABEL_CLASS =
  "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/90";

export const NAV_SECTION_DIVIDER_COLLAPSED_CLASS = "my-0.5 border-t border-line";
