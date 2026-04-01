/** 与 GET /api/v1/subscription/plans 中 plans[] 对齐（扩展字段可选以兼容旧响应） */

export type SummaryQuota = {
  key: string;
  label: string;
  value: string;
};

/** 与 GET /api/v1/subscription/plans 中 wallet_topup.usage_reference 对齐 */
export type WalletUsageReference = {
  audio_yuan_per_minute_range?: { low: number; high: number };
  /** 仅 LLM 写稿；千字 = 生成稿约 1000 字 */
  text_generation_only?: {
    thousand_output_chars_yuan_range: { low: number; high: number };
  };
  voice_clone_payg_cents?: number;
  disclaimer_zh?: string;
};

export type WalletTopupPayload = {
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
