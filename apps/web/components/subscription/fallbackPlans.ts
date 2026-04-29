/**
 * 当 /api/subscription/plans 不可用时的兜底套餐数据。
 * 请与 `services/orchestrator/app/plan_catalog.py` 中各档位文案与配额保持同步。
 */
import type { PricingPlan } from "./types";

export const FALLBACK_SUBSCRIPTION_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    monthly_price_cents: 0,
    yearly_price_cents: 0,
    description: "",
    summary_quotas: [
      { key: "minutes", label: "月目标生成时长", value: "20 分钟" },
      { key: "clones", label: "每月含音色克隆", value: "0 次" },
      { key: "long_form", label: "长文与长文播客单次目标字数上限", value: "5000 字" }
    ],
    feature_bullets: [
      "标准音色与导出，单任务创作",
      "知识库可参考少量资料完成成稿",
      "配额见上表，升级解锁更长单次成稿字数与更高额度"
    ],
    inherits_label: null
  },
  {
    id: "basic",
    name: "Basic",
    monthly_price_cents: 1990,
    yearly_price_cents: 0,
    badge: "starter",
    description: "轻量订阅 · ¥19.9/月",
    summary_quotas: [
      { key: "minutes", label: "月目标生成时长", value: "80 分钟" },
      { key: "clones", label: "每月含音色克隆", value: "1 次" },
      { key: "long_form", label: "长文与长文播客单次目标字数上限", value: "8000 字" }
    ],
    inherits_label: "相对 Free 的提升：",
    feature_bullets: [
      "月目标生成时长更高；单次成稿字数等配额见上表",
      "标准导出（mp3）；不含去水印与口语润色（Pro 起）",
      "每月含 1 次音色克隆（超出可按 ¥9.9/次购买）",
      "适合轻量周更"
    ]
  },
  {
    id: "pro",
    name: "Pro",
    monthly_price_cents: 7990,
    yearly_price_cents: 0,
    badge: "popular",
    description: "个人创作者首选 · 稳定周更 · ¥79.9/月",
    summary_quotas: [
      { key: "minutes", label: "月目标生成时长", value: "400 分钟" },
      { key: "clones", label: "每月含音色克隆", value: "2 次" },
      { key: "long_form", label: "长文与长文播客单次目标字数上限", value: "20000 字" }
    ],
    inherits_label: "Basic+ 的核心升级：",
    feature_bullets: [
      "更高月目标生成时长与单次成稿字数上限（见上表）",
      "高质量导出、去水印",
      "口语润色（TTS 前）每月至多 30 次",
      "每月 2 次音色克隆额度（超出可按次购买）",
      "标准商用授权"
    ]
  },
  {
    id: "max",
    name: "Max",
    monthly_price_cents: 19900,
    yearly_price_cents: 0,
    description: "重度创作 · 批量与更高优先级 · ¥199/月",
    summary_quotas: [
      { key: "minutes", label: "月目标生成时长", value: "800 分钟" },
      { key: "clones", label: "每月含音色克隆", value: "3 次" },
      { key: "long_form", label: "长文与长文播客单次目标字数上限", value: "50000 字" }
    ],
    inherits_label: "Pro 的全部权益，另含：",
    feature_bullets: [
      "顶配月目标生成时长与单次成稿字数上限（见上表）",
      "批量处理、更高队列优先级（产品口径）",
      "口语润色（TTS 前）不限（矩阵语义）",
      "每月 3 次音色克隆额度",
      "增强商用授权与发布能力"
    ]
  }
];
