"""
订阅套餐与加购 API 组装。

- 价目与期限来自 `subscription_manifest`；权益摘要来自 `entitlement_matrix`。
- 供 /api/v1/subscription/plans 与管理员模拟支付使用。
"""

from __future__ import annotations

import os
from typing import Any

from .entitlement_matrix import (
    jobs_terminal_monthly_quota,
    long_form_script_chars_cap,
    max_note_refs_for_plan,
    monthly_minutes_product_target,
    tier_ai_polish_monthly_quota,
    voice_clone_monthly_included,
)
from .subscription_manifest import (
    BASIC_MONTHLY_CENTS,
    BASIC_YEARLY_CENTS,
    MAX_MONTHLY_CENTS,
    MAX_YEARLY_CENTS,
    PAYG_100_CENTS,
    PAYG_100_MINUTES,
    PAYG_30_CENTS,
    PAYG_30_MINUTES,
    PRO_MONTHLY_CENTS,
    PRO_YEARLY_CENTS,
    VOICE_CLONE_PAYG_CENTS,
    WALLET_TOPUP_MAX_CENTS,
    WALLET_TOPUP_MIN_CENTS,
)
from .usage_billing import estimate_llm_cost_cny
from .wechat_pay_native import wechat_native_ready


def _wallet_usage_reference() -> dict[str, Any]:
    """
    供前端充值区展示：
    - 播客时长：文本+合成至成片（按成片分钟），不含克隆；单价锚点与历史按次分钟包一致。
    - 文章字数：仅 LLM 写稿参考（与 usage_billing 同源模型与价目表），不含 TTS。
    """
    m30, c30 = PAYG_30_MINUTES, PAYG_30_CENTS
    m100, c100 = PAYG_100_MINUTES, PAYG_100_CENTS
    r30 = c30 / float(m30)
    r100 = c100 / float(m100)
    low_cpm_cents = min(r30, r100)
    high_cpm_cents = max(r30, r100)

    text_model = str(os.environ.get("MINIMAX_TEXT_MODEL") or "MiniMax-M2.7").strip()
    # 每生成约 1000 字文稿：输入规模取常见区间，仅 LLM 分项
    llm_low = estimate_llm_cost_cny(text_model=text_model, prompt_chars=1_000, completion_chars=1_000)
    llm_high = estimate_llm_cost_cny(text_model=text_model, prompt_chars=6_000, completion_chars=1_000)
    yuan_low, yuan_high = min(llm_low, llm_high), max(llm_low, llm_high)

    return {
        "audio_yuan_per_minute_range": {
            "low": round(low_cpm_cents / 100.0, 2),
            "high": round(high_cpm_cents / 100.0, 2),
        },
        "text_generation_only": {
            "thousand_output_chars_yuan_range": {
                # LLM 分项多为分厘级，保留三位避免与 TTS 分钟价混淆且区间可读
                "low": round(yuan_low, 3),
                "high": round(yuan_high, 3),
            },
        },
        "voice_clone_payg_cents": int(VOICE_CLONE_PAYG_CENTS),
        "disclaimer_zh": (
            "播客时长参考含文稿与语音合成至成片、按成片音频分钟计，不含音色克隆。"
            "文章字数参考仅大模型写稿，不含语音合成。"
            "以上为价目与模型价表推导；余额实际扣减以任务完成时执行为准。"
        ),
    }


def is_valid_wallet_topup_amount_cents(amount_cents: int) -> bool:
    """单次充值金额（分）是否在允许区间内。"""
    try:
        n = int(amount_cents)
    except (TypeError, ValueError):
        return False
    return WALLET_TOPUP_MIN_CENTS <= n <= WALLET_TOPUP_MAX_CENTS


def amount_cents_for_subscription(tier: str, billing_cycle: str) -> int:
    """返回应付金额（分）。free 或非订阅周期返回 0。"""
    t = (tier or "").strip().lower()
    bc = (billing_cycle or "").strip().lower()
    if t == "basic":
        if bc == "monthly":
            return BASIC_MONTHLY_CENTS
        if bc == "yearly":
            return BASIC_YEARLY_CENTS
    if t == "pro":
        if bc == "monthly":
            return PRO_MONTHLY_CENTS
        if bc == "yearly":
            return PRO_YEARLY_CENTS
    if t == "max":
        if bc == "monthly":
            return MAX_MONTHLY_CENTS
        if bc == "yearly":
            return MAX_YEARLY_CENTS
    return 0


def _yearly_discount_percent(monthly_cents: int, yearly_cents: int) -> int:
    """相对连续月付 ×12 的节省比例（整数百分比）。"""
    if monthly_cents <= 0 or yearly_cents <= 0:
        return 0
    full = monthly_cents * 12
    if full <= yearly_cents:
        return 0
    return max(0, min(99, int(round((1 - yearly_cents / full) * 100))))


def _yearly_equivalent_monthly_cents(yearly_cents: int) -> int:
    return int(yearly_cents // 12) if yearly_cents > 0 else 0


def _ai_polish_label(tier: str) -> str:
    q = tier_ai_polish_monthly_quota(tier)
    if q == 0:
        return "不可用"
    if q < 0:
        return "不限（矩阵语义）"
    return f"每月至多 {q} 次"


def _summary_quotas_for_tier(tier: str) -> list[dict[str, str]]:
    tid = (tier or "free").strip().lower()
    rows: list[dict[str, str]] = [
        {
            "key": "minutes",
            "label": "月目标生成时长",
            "value": f"{monthly_minutes_product_target(tid)} 分钟",
        },
    ]
    rows.extend(
        [
            {
                "key": "jobs",
                "label": "近30天完成创作上限",
                "value": f"{jobs_terminal_monthly_quota(tid)} 次",
            },
            {
                "key": "clones",
                "label": "每月含音色克隆",
                "value": f"{voice_clone_monthly_included(tid)} 次",
            },
            {
                "key": "note_refs",
                "label": "笔记播客参考笔记条数",
                "value": f"{max_note_refs_for_plan(tid)} 条",
            },
        ]
    )
    return rows


def _feature_bullets_for_tier(tier: str) -> tuple[str | None, list[str]]:
    tid = (tier or "free").strip().lower()
    if tid == "free":
        return None, [
            "基础音色与标准导出，单任务创作",
            "笔记播客可参考少量笔记完成成稿",
            "每月目标生成时长见上表（无额外一次性礼包）",
            "升级后解锁更长单次成稿字数、更高配额与 Pro 级能力",
        ]
    if tid == "basic":
        return "相对 Free 的提升：", [
            f"月配额与创作次数更高（仍低于 Pro）；单次长文/长文播客上限约 {long_form_script_chars_cap('basic')} 字",
            "标准导出（mp3）；不含去水印与 AI 润色（Pro 起）",
            "音色克隆需按次购买；升级 Pro 含每月克隆额度",
            "适合轻量周更：入门价锁定基础创作节奏",
        ]
    if tid == "pro":
        return "Basic+ 的核心升级：", [
            "更高月配额与创作次数上限（见上表）",
            f"长文与长文播客单次目标字数上限 {long_form_script_chars_cap('pro')} 字",
            "高质量导出、去水印",
            f"AI 润色（TTS 前）{_ai_polish_label('pro')}",
            "每月 2 次音色克隆额度（超出可按次购买）",
            "标准商用授权",
        ]
    if tid == "max":
        return "Pro 的全部权益，另含：", [
            "顶配月配额与创作次数上限",
            f"长文与长文播客单次目标字数上限 {long_form_script_chars_cap('max')} 字",
            "批量处理、更高队列优先级（产品口径）",
            f"AI 润色（TTS 前）{_ai_polish_label('max')}",
            "每月 3 次音色克隆额度",
            "增强商用授权与发布能力",
        ]
    return None, []


def _badge_for_tier(tier: str) -> str | None:
    t = (tier or "").strip().lower()
    if t == "basic":
        return "starter"
    if t == "pro":
        return "popular"
    return None


def _plan_entry(
    tier: str,
    name: str,
    monthly_cents: int,
    yearly_cents: int,
    description: str,
) -> dict[str, Any]:
    inherits, bullets = _feature_bullets_for_tier(tier)
    out: dict[str, Any] = {
        "id": tier,
        "name": name,
        "monthly_price_cents": monthly_cents,
        "yearly_price_cents": yearly_cents,
        "description": description,
        "badge": _badge_for_tier(tier),
        "summary_quotas": _summary_quotas_for_tier(tier),
        "feature_bullets": bullets,
        "inherits_label": inherits,
        "yearly_equivalent_monthly_cents": _yearly_equivalent_monthly_cents(yearly_cents)
        if yearly_cents > 0
        else 0,
        "plan_yearly_discount_percent": _yearly_discount_percent(monthly_cents, yearly_cents)
        if monthly_cents > 0 and yearly_cents > 0
        else 0,
    }
    return out


def build_subscription_plans_response() -> dict[str, Any]:
    """公开套餐列表 + 钱包充值说明；含 ListenHub 式卡片扩展字段。"""
    disc_basic = _yearly_discount_percent(BASIC_MONTHLY_CENTS, BASIC_YEARLY_CENTS)
    disc_pro = _yearly_discount_percent(PRO_MONTHLY_CENTS, PRO_YEARLY_CENTS)
    disc_max = _yearly_discount_percent(MAX_MONTHLY_CENTS, MAX_YEARLY_CENTS)
    headline_yearly_discount = max(disc_basic, disc_pro, disc_max)

    plans = [
        _plan_entry(
            "free",
            "Free",
            0,
            0,
            "入门体验 · 含每月目标生成时长（产品口径）",
        ),
        _plan_entry(
            "basic",
            "Basic",
            BASIC_MONTHLY_CENTS,
            BASIC_YEARLY_CENTS,
            "轻量订阅 · ¥9.9/月 起 · 介于 Free 与 Pro 之间",
        ),
        _plan_entry(
            "pro",
            "Pro",
            PRO_MONTHLY_CENTS,
            PRO_YEARLY_CENTS,
            "个人创作者首选 · 稳定周更",
        ),
        _plan_entry(
            "max",
            "Creator（Max）",
            MAX_MONTHLY_CENTS,
            MAX_YEARLY_CENTS,
            "重度创作 · 批量与更高优先级",
        ),
    ]

    return {
        "success": True,
        "currency": "CNY",
        "yearly_discount_percent": headline_yearly_discount,
        "plans": plans,
        "addons": [],
        "wallet_topup": {
            "enabled": True,
            "min_amount_cents": WALLET_TOPUP_MIN_CENTS,
            "max_amount_cents": WALLET_TOPUP_MAX_CENTS,
            "currency": "CNY",
            "checkout_supported": True,
            "description": "充值进入账户余额（人民币），按实际使用扣减；单次充值最低 ¥10，不设过期；不改变当前订阅档位。",
            "usage_reference": _wallet_usage_reference(),
        },
        "payment_channels": {
            "wechat_native": {
                "enabled": bool(wechat_native_ready()),
                "label_zh": "微信扫码支付（PC）",
            },
        },
        "note": "prices_from_subscription_manifest",
    }
