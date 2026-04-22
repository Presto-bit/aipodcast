"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const STORAGE_KEY = "fym-app-release";

/** 与构建时注入的 NEXT_PUBLIC_APP_VERSION 一致；未设置时不同步，避免本地 dev 无意义清空 */
const current =
  typeof process.env.NEXT_PUBLIC_APP_VERSION === "string" && process.env.NEXT_PUBLIC_APP_VERSION.length > 0
    ? process.env.NEXT_PUBLIC_APP_VERSION
    : "";

/**
 * 发版后版本号变化时清空 React Query 缓存，避免旧接口数据与新前端并存。
 */
export default function DeployVersionSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!current) return;
    try {
      const prev = localStorage.getItem(STORAGE_KEY);
      if (prev !== null && prev !== current) {
        queryClient.clear();
      }
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // ignore
    }
  }, [queryClient]);
  return null;
}
