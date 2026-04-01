"""订阅档位与功能上限（与 subscription/me 的 plan 字段对齐：free / basic / pro / max）。"""

import os

from .entitlement_matrix import (
    max_note_refs_for_plan,
    tier_allows_ai_polish_entitlement,
    tier_ai_polish_monthly_quota,
)

__all__ = [
    "ai_polish_feature_enabled",
    "tier_allows_ai_polish",
    "tier_ai_polish_monthly_quota",
    "max_note_refs_for_plan",
]


def ai_polish_feature_enabled() -> bool:
    """总开关：设为 0/false/off 时全站关闭 AI润色（仍不调用模型）。"""
    v = (os.getenv("AI_POLISH_FEATURE_ENABLED") or "1").strip().lower()
    return v not in ("0", "false", "off", "no")


def tier_allows_ai_polish(tier: str | None) -> bool:
    """AI 润色（进 TTS 前文本模型）是否允许；受 ai_polish_feature_enabled() 与权益矩阵约束。"""
    if not ai_polish_feature_enabled():
        return False
    return tier_allows_ai_polish_entitlement(tier)
