import type { ReactNode } from "react";
import ShellProviders from "../ShellProviders";

/**
 * 工作台页面均为 client 组件 + Cookie 会话；layout 不再 force-dynamic 读编排器，
 * 避免每次软路由都重复 resolveAuthSessionServer。首屏会话由 AuthProvider 客户端 bootstrap。
 */
export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return <ShellProviders variant="static">{children}</ShellProviders>;
}
