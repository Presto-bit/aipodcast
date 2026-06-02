/** 历史 localStorage 键（侧栏折叠不再持久化，保留供旧数据只读兼容）。 */
export const APP_SIDEBAR_COLLAPSED_KEY = "fym_web_sidebar_collapsed";

/** 请求折叠主导航（派发事件，供 AppShell 立即响应） */
export const APP_SIDEBAR_COLLAPSE_EVENT = "fym:app-sidebar-collapse";

/** 主导航侧栏折叠状态已切换（用户点击或程序化切换后派发，供子页面同步布局） */
export const APP_SIDEBAR_TOGGLE_EVENT = "fym:app-sidebar-toggle";

export function requestAppSidebarCollapse(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT));
}
