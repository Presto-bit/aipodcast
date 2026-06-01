/** 个人特色 IP（v6 笔记本风格）：类型与最小 API 客户端 */

import { apiErrorMessage } from "./apiError";

export type AuthorIpMaturity = "empty" | "sketch" | "sketch_plus" | "ready" | "stale";

export type AuthorIpItem = {
  id: string;
  displayName: string;
  subtitle: string;
  avatarColor: string;
  notebookName: string;
  isDefault: boolean;
  isSystemSeed: boolean;
  isTemplate: boolean;
  isReadOnly: boolean;
  templateId: string | null;
  maturity: AuthorIpMaturity | string;
  oneLiner: string;
  profile: Record<string, unknown>;
  materialCount: number;
  traitCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AuthorIpLearnMode = "lite" | "full";

function authHeaders(): HeadersInit {
  return { "content-type": "application/json" };
}

export async function fetchAuthorIpByNotebook(notebookName: string): Promise<AuthorIpItem | null> {
  const q = new URLSearchParams({ notebookName });
  const res = await fetch(`/api/author-ips/by-notebook?${q}`, {
    cache: "no-store",
    credentials: "include",
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "加载风格失败"));
  }
  const item = (data as { item?: AuthorIpItem | null }).item;
  return item ?? null;
}

export async function ensureAuthorIpForNotebook(notebookName: string): Promise<AuthorIpItem> {
  const res = await fetch("/api/author-ips/by-notebook", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ notebookName })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "创建风格失败"));
  }
  const item = (data as { item?: AuthorIpItem }).item;
  if (!item?.id) {
    throw new Error(apiErrorMessage(data, "创建风格失败：服务未返回有效数据"));
  }
  return item;
}

export async function learnAuthorIp(
  ipId: string,
  mode: AuthorIpLearnMode = "full",
  noteIds?: string[]
): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/learn`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      mode,
      ...(noteIds && noteIds.length > 0 ? { noteIds } : {})
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "学习失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

/** 按笔记本名改名（不依赖 ipId，避免脏 id / 切换笔记本时 PATCH 错记录） */
export async function renameAuthorIpForNotebook(
  notebookName: string,
  displayName: string
): Promise<AuthorIpItem> {
  const nb = String(notebookName || "").trim();
  const name = String(displayName || "").trim();
  if (!nb) {
    throw new Error("请先选择笔记本");
  }
  if (!name) {
    throw new Error("名称不能为空");
  }
  const res = await fetch("/api/author-ips/by-notebook", {
    method: "PATCH",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ notebookName: nb, displayName: name })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, "保存失败"));
  }
  const item = (data as { item?: AuthorIpItem }).item;
  if (!item?.id) {
    throw new Error(apiErrorMessage(data, "保存失败：服务未返回有效数据"));
  }
  if ((item.displayName || "").trim() !== name) {
    throw new Error("保存失败：名称未更新，请刷新后重试");
  }
  return item;
}

export async function patchAuthorIp(
  ipId: string,
  patch: { displayName?: string; isDefault?: boolean }
): Promise<AuthorIpItem> {
  const id = String(ipId || "").trim();
  if (!id) {
    throw new Error("风格记录无效，请刷新页面后重试");
  }
  const body: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    body.displayName = patch.displayName.trim();
  }
  if (patch.isDefault !== undefined) {
    body.isDefault = patch.isDefault;
  }
  const res = await fetch(`/api/author-ips/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, "保存失败"));
  }
  const item = (data as { item?: AuthorIpItem }).item;
  if (!item?.id) {
    throw new Error(apiErrorMessage(data, "保存失败：服务未返回有效数据"));
  }
  return item;
}
