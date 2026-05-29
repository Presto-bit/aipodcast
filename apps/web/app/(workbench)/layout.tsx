import type { ReactNode } from "react";

/**
 * 工作台路由组；会话与 AppShell 由根 layout 的 ShellProviders 统一提供。
 */
export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return children;
}
