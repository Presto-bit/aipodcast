/** 工作台全屏弹层 z-index：低于侧栏/汉堡（100000+），高于页面内局部层 */
export const WORKBENCH_SCRIM_Z_CLASS = "z-[99990]";

/** 侧栏导航或路由切换时：关闭各页未退出的 fym-workspace-scrim 弹层 */
export const WORKBENCH_DISMISS_OVERLAYS_EVENT = "fym:workbench-dismiss-overlays";

export function dispatchWorkbenchDismissOverlays(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKBENCH_DISMISS_OVERLAYS_EVENT, { bubbles: false }));
}
