"""
语音 / 文稿预授权：上限估算、hold 分钟与钱包预扣分计算。

- 语音：预估分钟 × 缓冲 → hold 分钟 → 超出体验包后的钱包预扣。
- 文稿：字数上界 → 超出体验包字数后的钱包预扣。
- 结算在 models._core（体验包消耗 + 预扣与实扣差额退回）。
"""

from __future__ import annotations

import math
from typing import Any

VOICE_HOLD_BUFFER_RATIO = 1.2
VOICE_HOLD_BUFFER_MINUTES = 0.5
VOICE_HOLD_MAX_RATIO = 1.5
VOICE_HOLD_MAX_EXTRA_MINUTES = 3.0

# 成片语音结算：不足 0.1 分钟按 0.1 向上（产品口径）
VOICE_BILLED_MINUTE_GRANULARITY = 0.1


def round_voice_billed_minutes(minutes: float) -> float:
    """口播计费分钟：向上取整到 0.1 分钟。"""
    m = max(0.0, float(minutes))
    if m <= 1e-9:
        return 0.0
    step = float(VOICE_BILLED_MINUTE_GRANULARITY)
    return math.ceil(m / step) * step


def voice_hold_minutes(estimated_minutes: float) -> float:
    """
    预授权口播分钟上界：max(估×1.2, 估+0.5)，且不超过 min(估×1.5, 估+3)。
    """
    est = max(0.05, float(estimated_minutes))
    buffered = max(est * VOICE_HOLD_BUFFER_RATIO, est + VOICE_HOLD_BUFFER_MINUTES)
    cap = min(est * VOICE_HOLD_MAX_RATIO, est + VOICE_HOLD_MAX_EXTRA_MINUTES)
    return max(est, min(buffered, cap))


def wallet_cents_for_voice_wallet_minutes(wallet_minutes: float) -> int:
    from .media_wallet import wallet_cents_for_overage_minutes

    return int(wallet_cents_for_overage_minutes(max(0.0, float(wallet_minutes))))


def preview_voice_preauth_wallet_cents(experience_voice_minutes: float, estimated_minutes: float) -> tuple[float, int]:
    """
    返回 (hold_minutes, preauth_wallet_cents)。
    预扣仅覆盖「hold 分钟 − 当前体验包语音」可能走钱包的部分。
    """
    hold = voice_hold_minutes(estimated_minutes)
    ex = max(0.0, float(experience_voice_minutes))
    wallet_min = max(0.0, hold - ex)
    return hold, wallet_cents_for_voice_wallet_minutes(wallet_min)


def preview_script_preauth_wallet_cents(experience_text_chars: int, char_cap: int) -> int:
    from .media_wallet import wallet_cents_for_generated_text_chars

    cap = max(0, int(char_cap))
    ex = max(0, int(experience_text_chars))
    rest = max(0, cap - ex)
    return int(wallet_cents_for_generated_text_chars(rest))
