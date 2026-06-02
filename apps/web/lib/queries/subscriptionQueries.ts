"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newRechargeDebugRequestId } from "../rechargeClientDebug";

export type PlansPayload = {
  success?: boolean;
  plans?: unknown[];
  wallet_topup?: unknown;
  payment_channels?: {
    alipay_page?: { enabled?: unknown; label_zh?: string };
  };
  error?: string;
  detail?: string;
  [key: string]: unknown;
};

export type SubscriptionMeParams = {
  consumptionSince?: string;
  consumptionUntil?: string;
  rechargePage?: number;
  consumptionPage?: number;
};

export type PlansFetchResult = {
  httpOk: boolean;
  httpStatus: number;
  payload: PlansPayload;
};

export type SubscriptionMePayload = {
  success?: boolean;
  recharge_records?: unknown[];
  consumption_records?: unknown[];
  recharge_pagination?: { page?: number; page_size?: number; total?: number };
  consumption_pagination?: { page?: number; page_size?: number; total?: number };
  consumption_filtered_wallet_total_cents?: number | null;
  wallet_balance_cents?: number;
  experience?: {
    voice_minutes_remaining?: number;
    asr_minutes_remaining?: number;
    text_chars_remaining?: number;
    voice_minutes_total?: number | null;
    asr_minutes_total?: number | null;
    text_chars_total?: number | null;
  };
  error?: string;
  detail?: string;
  [key: string]: unknown;
};

export type SubscriptionMeFetchResult = {
  httpOk: boolean;
  httpStatus: number;
  path: string;
  payload: SubscriptionMePayload;
  requestId: string;
};

export function subscriptionMeQueryKey(params: SubscriptionMeParams) {
  return [
    "subscription-me",
    params.consumptionSince ?? "",
    params.consumptionUntil ?? "",
    params.rechargePage ?? 1,
    params.consumptionPage ?? 1
  ] as const;
}

export async function fetchSubscriptionPlans(headers: Record<string, string>): Promise<PlansFetchResult> {
  const res = await fetch("/api/subscription/plans", { cache: "no-store", headers });
  const payload = (await res.json().catch(() => ({}))) as PlansPayload;
  return { httpOk: res.ok, httpStatus: res.status, payload };
}

async function fetchSubscriptionMe(
  headers: Record<string, string>,
  params: SubscriptionMeParams,
  pageSize: number
): Promise<SubscriptionMeFetchResult> {
  const requestId = newRechargeDebugRequestId();
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
  const res = await fetch(path, { cache: "no-store", headers: { ...headers, "x-request-id": requestId } });
  const payload = (await res.json().catch(() => ({}))) as SubscriptionMePayload;
  return { httpOk: res.ok, httpStatus: res.status, path, payload, requestId };
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
