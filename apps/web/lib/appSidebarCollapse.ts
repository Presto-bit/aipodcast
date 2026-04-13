/** 与 AppShell 侧栏折叠状态共用同一 localStorage 键 */
export const APP_SIDEBAR_COLLAPSED_KEY = "fym_web_sidebar_collapsed";

/** 请求折叠主导航（写入 localStorage 并派发事件，供当前页 AppShell 立即响应） */
export const APP_SIDEBAR_COLLAPSE_EVENT = "fym:app-sidebar-collapse";

export function requestAppSidebarCollapse(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_SIDEBAR_COLLAPSED_KEY, "1");
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT));
}
