/** 与 GET /api/v1/subscription/plans 中 plans[] 对齐（扩展字段可选以兼容旧响应） */

export type SummaryQuota = {
  key: string;
  label: string;
  value: string;
};

/** 与 GET /api/v1/subscription/plans 中 wallet_topup.usage_reference 对齐 */
export type WalletUsageReference = {
  /** 成片播客：元/分钟（分钟包最优单价折算） */
  podcast_yuan_per_minute?: number;
  voice_clone_payg_cents?: number;
  disclaimer_zh?: string;
};

export type WalletTopupPayload = {
  /** 为 false 时隐藏整个钱包充值区（与 orchestrator plans.wallet_topup.enabled 对齐） */
  enabled?: boolean;
  min_amount_cents?: number;
  max_amount_cents?: number;
  description?: string;
  checkout_supported?: boolean;
  usage_reference?: WalletUsageReference;
};

export type PricingPlan = {
  id: string;
  name?: string;
  description?: string;
  monthly_price_cents?: number | null;
  yearly_price_cents?: number | null;
  badge?: string | null;
  summary_quotas?: SummaryQuota[];
  feature_bullets?: string[];
  inherits_label?: string | null;
  yearly_equivalent_monthly_cents?: number;
  plan_yearly_discount_percent?: number;
};
