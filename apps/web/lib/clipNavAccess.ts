import { ADMIN_ROLE } from "./appShellLayout";

/**
 * 侧栏与 /clip 路由：默认仅管理员可见；全量开放时设置 NEXT_PUBLIC_CLIP_NAV_PUBLIC=1。
 */
export function isClipNavPublicForAllUsers(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLIP_NAV_PUBLIC === "1";
}

export function canUseClipStudio(userRole: string | undefined | null): boolean {
  if (isClipNavPublicForAllUsers()) return true;
  return String(userRole || "").trim().toLowerCase() === ADMIN_ROLE;
}
