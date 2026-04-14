/**
 * 识别「媒体钱包 / 分钟包」类提示文案，便于在 UI 中追加充值与订阅入口。
 * 与 orchestrator `jobs_routes._media_job_wallet_preview_dict` 返回的 detail 口径对齐。
 */
export function messageLooksLikeWalletTopupHint(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (/请先充值/.test(s)) return true;
  if (/超出当前套餐与分钟包/.test(s) && /钱包余额/.test(s)) return true;
  if (/套餐内克隆次数已用完/.test(s) && /充值/.test(s)) return true;
  return false;
}

/**
 * 任务详情、列表、画廊等场景的宽松匹配：除「请先充值」类外，也覆盖明显为按量/钱包的成片预估计费说明。
 */
export function messageSuggestsBillingTopUpOrSubscription(text: string): boolean {
  if (messageLooksLikeWalletTopupHint(text)) return true;
  const s = text.trim();
  if (!s) return false;
  if (/超出当前套餐与分钟包/.test(s)) return true;
  if (/超出.*套餐.*分钟包/.test(s) && /钱包|余额|¥|￥/.test(s)) return true;
  return false;
}

/** 订阅页「账户余额充值」区块锚点（与 page 内 id 一致） */
export const SUBSCRIPTION_WALLET_TOPUP_HASH = "#wallet-topup";
