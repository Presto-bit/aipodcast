"""
钱包计费与公开价目 API 组装。

- 价目来自 `subscription_manifest`；用量上限来自 `entitlement_matrix`。
- 供 GET /api/v1/subscription/wallet-catalog 等使用。
"""

from __future__ import annotations

from typing import Any

from .subscription_manifest import (
    EXPERIENCE_NEW_USER_TEXT_CHARS,
    EXPERIENCE_NEW_USER_VOICE_MINUTES,
    PAYG_100_CENTS,
    PAYG_100_MINUTES,
    PAYG_30_CENTS,
    PAYG_30_MINUTES,
    TEXT_OUTPUT_CENTS_PER_10K_CHARS,
    VOICE_CLONE_PAYG_CENTS,
    WALLET_TOPUP_MAX_CENTS,
    WALLET_TOPUP_MIN_CENTS,
    WALLET_TOPUP_SUGGESTED_YUAN,
)
from .alipay_page_pay import alipay_page_pay_ready


def _wallet_usage_reference() -> dict[str, Any]:
    """
    供前端充值区「扣费参考」：
    - 成片语音：manifest 分钟单价（元/分钟）；AI 润色不单列，含于该单价。
    - 脚本文本：按成稿字符数，元/万字（由 TEXT_OUTPUT_CENTS_PER_10K_CHARS 换算）。
    - 克隆：manifest 按次价（分）。
    """
    m30, c30 = PAYG_30_MINUTES, PAYG_30_CENTS
    m100, c100 = PAYG_100_MINUTES, PAYG_100_CENTS
    r30 = c30 / float(m30)
    r100 = c100 / float(m100)
    best_cpm_cents = min(r30, r100)
    podcast_yuan_per_minute = round(best_cpm_cents / 100.0, 2)
    text_yuan_per_10k_chars = round(float(TEXT_OUTPUT_CENTS_PER_10K_CHARS) / 100.0, 2)

    return {
        "podcast_yuan_per_minute": podcast_yuan_per_minute,
        "text_yuan_per_10k_chars": text_yuan_per_10k_chars,
        "voice_clone_payg_cents": int(VOICE_CLONE_PAYG_CENTS),
        "experience_voice_minutes_new_user": float(EXPERIENCE_NEW_USER_VOICE_MINUTES),
        "experience_text_chars_new_user": int(EXPERIENCE_NEW_USER_TEXT_CHARS),
        "disclaimer_zh": "新注册用户获赠一次性体验包（语音分钟与文本字数）；用尽后按上表从余额扣费。",
    }


def is_valid_wallet_topup_amount_cents(amount_cents: int) -> bool:
    """单次充值金额（分）是否在允许区间内。"""
    try:
        n = int(amount_cents)
    except (TypeError, ValueError):
        return False
    return WALLET_TOPUP_MIN_CENTS <= n <= WALLET_TOPUP_MAX_CENTS


def build_wallet_catalog_response() -> dict[str, Any]:
    """公开计费配置：仅钱包充值与用量参考。"""
    try:
        alipay_ready = alipay_page_pay_ready()
    except Exception:
        alipay_ready = False
    out: dict[str, Any] = {
        "success": True,
        "currency": "CNY",
        "billing_monthly_only": False,
        "yearly_discount_percent": 0,
        "offers": [],
        "addons": [],
        "wallet_topup": {
            "enabled": True,
            "min_amount_cents": WALLET_TOPUP_MIN_CENTS,
            "max_amount_cents": WALLET_TOPUP_MAX_CENTS,
            "currency": "CNY",
            "suggested_topup_yuan": list(WALLET_TOPUP_SUGGESTED_YUAN),
            "checkout_supported": not alipay_ready,
            "description": "",
            "usage_reference": _wallet_usage_reference(),
        },
        "payment_channels": {
            "alipay_page": {
                "enabled": alipay_ready,
                "label_zh": "支付宝扫码支付（电脑网站）",
            },
        },
        "note": "wallet_billing_catalog",
    }
    return out
