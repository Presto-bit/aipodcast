"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export type PlansPayload = {
  success?: boolean;
  plans?: unknown[];
  wallet_topup?: unknown;
  [key: string]: unknown;
};

export type SubscriptionMeParams = {
  consumptionSince?: string;
  consumptionUntil?: string;
  rechargePage?: number;
  consumptionPage?: number;
};

function subscriptionMeQueryKey(params: SubscriptionMeParams) {
  return [
    "subscription-me",
    params.consumptionSince ?? "",
    params.consumptionUntil ?? "",
    params.rechargePage ?? 1,
    params.consumptionPage ?? 1
  ] as const;
}

async function fetchSubscriptionPlans(headers: Record<string, string>): Promise<PlansPayload> {
  const res = await fetch("/api/subscription/plans", { cache: "no-store", headers });
  const data = (await res.json().catch(() => ({}))) as PlansPayload;
  if (!res.ok || data.success === false) {
    throw new Error(String(data.error || data.detail || `加载套餐失败 ${res.status}`));
  }
  return data;
}

async function fetchSubscriptionMe(
  headers: Record<string, string>,
  params: SubscriptionMeParams,
  pageSize: number
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  const sUse = params.consumptionSince?.trim() ?? "";
  const tUse = params.consumptionUntil?.trim() ?? "";
  if (sUse) qs.set("consumption_since", sUse);
  if (tUse) qs.set("consumption_until", tUse);
  qs.set("recharge_page", String(params.rechargePage ?? 1));
  qs.set("recharge_page_size", String(pageSize));
  qs.set("consumption_page", String(params.consumptionPage ?? 1));
  qs.set("consumption_page_size", String(pageSize));
  const path = `/api/subscription/me?${qs.toString()}`;
  const res = await fetch(path, { cache: "no-store", headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.success === false) {
    throw new Error(String(data.error || data.detail || `加载账户失败 ${res.status}`));
  }
  return data;
}

export function useSubscriptionPlansQuery(
  getAuthHeaders: () => Record<string, string>,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["subscription-plans"],
    queryFn: () => fetchSubscriptionPlans(getAuthHeaders()),
    enabled,
    staleTime: 120_000
  });
}

export function useSubscriptionMeQuery(
  getAuthHeaders: () => Record<string, string>,
  enabled: boolean,
  params: SubscriptionMeParams,
  pageSize: number,
  refetchIntervalMs?: number | false
) {
  return useQuery({
    queryKey: subscriptionMeQueryKey(params),
    queryFn: () => fetchSubscriptionMe(getAuthHeaders(), params, pageSize),
    enabled,
    staleTime: 15_000,
    refetchInterval: (query) => {
      if (!refetchIntervalMs || !enabled) return false;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      return refetchIntervalMs;
    }
  });
}

export function useInvalidateSubscription() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
    void queryClient.invalidateQueries({ queryKey: ["subscription-me"] });
  };
}
