import type { ReactNode } from "react";
import ShellProviders from "../ShellProviders";

/** 登录/法务等公开页：静态壳 + 后台可选刷新会话 */
export const revalidate = 3600;

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <ShellProviders variant="static">{children}</ShellProviders>;
}
