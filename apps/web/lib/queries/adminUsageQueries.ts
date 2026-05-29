"use client";

import { useQuery } from "@tanstack/react-query";

export type AdminUsageTab = "overview" | "ledger" | "orders" | "users" | "works" | "alerts";

async function adminFetch<T>(
  path: string,
  headers: Record<string, string>
): Promise<T> {
  const res = await fetch(path, { headers, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!res.ok || data.success === false) {
    throw new Error(String(data.error || `加载失败 ${res.status}`));
  }
  return data;
}

export function useAdminUsageOverviewQuery(
  getAuthHeaders: () => Record<string, string>,
  query: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-overview", query],
    queryFn: () =>
      adminFetch(`/api/admin/usage/dashboard?${query}`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}

export function useAdminUsageLedgerQuery(
  getAuthHeaders: () => Record<string, string>,
  ledgerQuery: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-ledger", ledgerQuery],
    queryFn: () =>
      adminFetch(`/api/admin/usage/revenue-expense?${ledgerQuery}`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}

export function useAdminUsageOrdersQuery(
  getAuthHeaders: () => Record<string, string>,
  query: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-orders", query],
    queryFn: () => adminFetch(`/api/admin/usage/orders?${query}`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}

export function useAdminUsageUsersQuery(
  getAuthHeaders: () => Record<string, string>,
  query: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-users", query],
    queryFn: () =>
      adminFetch(`/api/admin/usage/users?${query}&limit=100`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}

export function useAdminUsageWorksQuery(
  getAuthHeaders: () => Record<string, string>,
  query: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-works", query],
    queryFn: () => adminFetch(`/api/admin/usage/works?${query}`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}

export function useAdminUsageAlertsQuery(
  getAuthHeaders: () => Record<string, string>,
  query: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["admin-usage-alerts", query],
    queryFn: () => adminFetch(`/api/admin/usage/alerts?${query}`, getAuthHeaders()),
    enabled,
    staleTime: 45_000
  });
}
