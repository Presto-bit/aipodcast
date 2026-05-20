"use client";

import { useEffect } from "react";
import { requestAppSidebarCollapse } from "../../lib/appSidebarCollapse";

/**
 * 进入剪辑列表/工程后默认收起主导航，把横向空间留给稿面与音频区。
 * 布局实例在 /clip/* 内保持，不会在子路由切换时重复执行折叠逻辑。
 */
export default function ClipLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    requestAppSidebarCollapse();
  }, []);
  return children;
}
