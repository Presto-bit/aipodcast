/** 作品下载：钱包充值门槛（与编排器 403 detail 对齐） */

export const WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE = "无法下载：需有充值记录";

export function isWorkDownloadRechargeGateError(message: unknown): boolean {
  const s = String(message ?? "");
  if (!s.trim()) return false;
  if (s.includes(WORK_DOWNLOAD_RECHARGE_GATE_USER_MESSAGE)) return true;
  if (s.includes("下载需有过钱包充值记录") || s.includes("钱包仍有余额")) return true;
  if (/需有充值记录|充值记录方可|无充值记录/i.test(s)) return true;
  return false;
}

export function openSubscriptionWalletTopup(): void {
  if (typeof window === "undefined") return;
  window.location.assign("/subscription#wallet-topup");
}
