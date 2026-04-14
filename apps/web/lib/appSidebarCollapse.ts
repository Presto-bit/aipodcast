/** 与 AppShell 侧栏折叠状态共用同一 localStorage 键（按账号隔离） */
import { writeLocalStorageScoped } from "./userScopedStorage";

export const APP_SIDEBAR_COLLAPSED_KEY = "fym_web_sidebar_collapsed";

/** 请求折叠主导航（写入 localStorage 并派发事件，供当前页 AppShell 立即响应） */
export const APP_SIDEBAR_COLLAPSE_EVENT = "fym:app-sidebar-collapse";

/** 主导航侧栏折叠状态已写入 localStorage（用户点击或程序化切换后派发，供子页面拉宽主内容区） */
export const APP_SIDEBAR_TOGGLE_EVENT = "fym:app-sidebar-toggle";

export function requestAppSidebarCollapse(): void {
  if (typeof window === "undefined") return;
  try {
    writeLocalStorageScoped(APP_SIDEBAR_COLLAPSED_KEY, "1");
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT));
}
