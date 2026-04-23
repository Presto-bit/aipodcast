"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const STORAGE_KEY = "fym-app-release";

/** 与构建时注入的 NEXT_PUBLIC_APP_VERSION 一致；未设置时不同步，避免本地 dev 无意义清空 */
const current =
  typeof process.env.NEXT_PUBLIC_APP_VERSION === "string" && process.env.NEXT_PUBLIC_APP_VERSION.length > 0
    ? process.env.NEXT_PUBLIC_APP_VERSION
    : "";

const rawBuildId =
  typeof process.env.NEXT_PUBLIC_APP_BUILD_ID === "string" ? process.env.NEXT_PUBLIC_APP_BUILD_ID.trim() : "";
const buildId = /^\d+$/.test(rawBuildId) ? parseInt(rawBuildId, 10) : 0;

type Stored = { id: number; v: string };

function parseStored(raw: string | null): Stored | null {
  if (raw === null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && "id" in o && "v" in o) {
      const id = Number((o as { id: unknown }).id);
      const v = String((o as { v: unknown }).v);
      if (Number.isFinite(id) && v.length > 0) return { id, v };
    }
  } catch {
    /* 旧格式：纯版本字符串 */
  }
  return { id: 0, v: raw };
}

/**
 * 发版后版本变化时清空 React Query，避免旧接口数据与新前端并存。
 * 生产镜像应带单调递增的 NEXT_PUBLIC_APP_BUILD_ID（release.sh 用 git rev-list --count 注入）：
 * 硬刷新后若普通刷新仍命中 CDN/浏览器旧 JS，旧包内嵌的 build id 会小于 localStorage 已记录值，
 * 此时只 clear、不把 localStorage 写回旧版本，避免「硬刷新新、软刷新又旧」被本地状态放大。
 */
export default function DeployVersionSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!current) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const prev = parseStored(raw);

      if (buildId > 0) {
        const next: Stored = { id: buildId, v: current };
        if (!prev) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          return;
        }
        if (buildId > prev.id) {
          queryClient.clear();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          return;
        }
        if (buildId < prev.id) {
          queryClient.clear();
          return;
        }
        if (prev.v !== current) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
        return;
      }

      const prevV = prev?.v ?? null;
      if (prevV !== null && prevV !== current) {
        queryClient.clear();
      }
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // ignore
    }
  }, [queryClient]);
  return null;
}
