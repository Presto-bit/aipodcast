/** 工作台全屏弹层 z-index：低于侧栏（300000），高于页面内局部层 */
export const WORKBENCH_SCRIM_Z_CLASS = "z-[99990]";
/** 侧栏/汉堡 z-index：须高于一切工作台弹层与 portal 菜单 */
export const WORKBENCH_SIDEBAR_Z_CLASS = "z-[300000]";
export const WORKBENCH_MOBILE_FAB_Z_CLASS = "z-[300010]";

/** 侧栏导航或路由切换时：关闭各页未退出的 fym-workspace-scrim 弹层 */
export const WORKBENCH_DISMISS_OVERLAYS_EVENT = "fym:workbench-dismiss-overlays";

export function dispatchWorkbenchDismissOverlays(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKBENCH_DISMISS_OVERLAYS_EVENT, { bubbles: false }));
}
