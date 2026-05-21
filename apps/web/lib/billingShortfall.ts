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
  if (/余额或套餐不足/.test(s)) return true;
  if (/钱包余额/.test(s) && (/不足|请先/).test(s)) return true;
  if (/预估.*分钟.*超出体验包/.test(s) && /充值/.test(s)) return true;
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
  if (/订阅与订单/.test(s) && /余额|套餐|充值|钱包/.test(s)) return true;
  return false;
}

/** 订阅页打开充值弹窗的锚点（与 subscription/page 内 hash 处理一致） */
export const SUBSCRIPTION_WALLET_TOPUP_HASH = "#wallet-topup";

const WALLET_BILLING_DETAIL_RE =
  /脚本文本|语音预估|预估计费|当前余额|钱包余额|预估需从钱包|超出体验包.*约需/;

/** 将编排器钱包预检/入队错误中的金额明细收敛为对用户友好的短文案 */
export function simplifyWalletBillingMessageForUi(text: string): string {
  const s = (text || "").trim();
  if (!s) return s;
  if (messageLooksLikeWalletTopupHint(s) || WALLET_BILLING_DETAIL_RE.test(s)) {
    return "余额不足，请先充值后再试。";
  }
  return s;
}
