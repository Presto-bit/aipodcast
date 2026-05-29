import type { ReactNode } from "react";

/** 登录/法务等公开页：静态壳 + 后台可选刷新会话（Providers 在根 layout） */
export const revalidate = 3600;

export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
