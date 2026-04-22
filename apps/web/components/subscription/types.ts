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
  /** 脚本/大纲成稿：元/万字 */
  text_yuan_per_10k_chars?: number;
  voice_clone_payg_cents?: number;
  /** 新用户语音体验包总量（分钟），与编排器 manifest 一致 */
  experience_voice_minutes_new_user?: number;
  /** 新用户文本体验包总量（字） */
  experience_text_chars_new_user?: number;
  disclaimer_zh?: string;
};

export type WalletTopupPayload = {
  /** 为 false 时隐藏整个钱包充值区（与 orchestrator plans.wallet_topup.enabled 对齐） */
  enabled?: boolean;
  min_amount_cents?: number;
  max_amount_cents?: number;
  /** 推荐快捷充值金额（元），如 30 / 50 / 100 */
  suggested_topup_yuan?: number[];
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
