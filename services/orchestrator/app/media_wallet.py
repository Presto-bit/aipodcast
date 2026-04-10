"""
TTS / 播客类任务的「套餐分钟 → 按次分钟包 → 钱包」预估与扣费辅助。

扣费执行在 models.media_billing_try_debit_estimated_minutes（事务内：扣分钟包 + 扣钱包）。
"""

from __future__ import annotations

import math
import os
from typing import Any

from .entitlement_matrix import normalize_script_target_input
from .subscription_manifest import (
    MEDIA_WALLET_CENTS_PER_MINUTE,
    MONTHLY_MINUTES_PRODUCT_BY_TIER,
    WALLET_REFERENCE_CHARS_PER_SPOKEN_MINUTE,
)

MEDIA_USAGE_PERIOD_DAYS = 30


def media_wallet_billing_enabled() -> bool:
    raw = (os.getenv("MEDIA_WALLET_BILLING_ENABLED") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def wallet_cents_for_overage_minutes(wallet_minutes: float) -> int:
    """超出配额与分钟包后，按 manifest 单价换算为应付分（至少 1 分）。"""
    if wallet_minutes <= 1e-9:
        return 0
    rate = float(MEDIA_WALLET_CENTS_PER_MINUTE)
    return max(1, int(math.ceil(float(wallet_minutes) * rate)))


def _chars_per_minute() -> float:
    try:
        n = float(WALLET_REFERENCE_CHARS_PER_SPOKEN_MINUTE)
    except (TypeError, ValueError):
        n = 250.0
    return max(30.0, n)


def estimate_spoken_minutes_tts(payload: dict[str, Any], body_text: str) -> float:
    """单人/扩展 TTS：按口语字数 ÷ 参考语速估分钟（下限约 3 秒）。"""
    intro = str(payload.get("intro_text") or "").strip()
    outro = str(payload.get("outro_text") or str(payload.get("ending_text") or "")).strip()
    body = (body_text or "").strip()
    spoken = "\n".join(x for x in (intro, body, outro) if x)
    if not spoken.strip():
        spoken = "你好，欢迎使用 AI Native Studio。"
    cpm = _chars_per_minute()
    return max(0.05, len(spoken) / cpm)


def _payload_source_char_est(payload: dict[str, Any]) -> int:
    parts: list[str] = []
    t = str(payload.get("text") or "").strip()
    if t:
        parts.append(t)
    u = str(payload.get("url") or "").strip()
    if u:
        parts.append(u)
    sn = payload.get("selected_note_ids")
    if isinstance(sn, list) and sn:
        parts.append("x" * min(8000, len(sn) * 400))
    return len("\n".join(parts))


def estimate_spoken_minutes_podcast_enqueue(payload: dict[str, Any]) -> float:
    """创建播客任务时尚无成稿：用 script_target_chars / 素材规模估分钟。"""
    intro = str(payload.get("intro_text") or "").strip()
    outro = str(payload.get("outro_text") or str(payload.get("ending_text") or "")).strip()
    st = normalize_script_target_input(payload.get("script_target_chars"))
    base_chars = int(st) if st is not None else _payload_source_char_est(payload)
    base_chars = max(200, min(50_000, int(base_chars)))
    total_chars = base_chars + len(intro) + len(outro)
    cpm = _chars_per_minute()
    return max(0.05, float(total_chars) / cpm)


def preview_wallet_cents_for_media_job(phone: str, tier: str | None, est_minutes: float) -> int:
    """不修改数据库：用于创建任务前的余额软校验。"""
    if not media_wallet_billing_enabled():
        return 0
    p = (phone or "").strip()
    if not p or est_minutes <= 1e-9:
        return 0
    from . import models

    used = float(models.subscription_media_usage_for_phone(p, MEDIA_USAGE_PERIOD_DAYS).get("audio_minutes_used") or 0)
    payg_avail = float(models.payg_minutes_remaining_for_phone(p))
    _, cents = split_estimated_minutes_to_wallet(used, tier, payg_avail, float(est_minutes))
    return int(cents)


def split_estimated_minutes_to_wallet(
    used_minutes: float,
    tier: str | None,
    payg_avail: float,
    est_minutes: float,
) -> tuple[float, int]:
    """
    返回 (wallet_minutes, wallet_cents)。
    先吃满订阅月配额剩余，再吃按次分钟包（payg_avail 为当前可用总量快照）。
    """
    t = (tier or "free").strip().lower()
    cap = int(MONTHLY_MINUTES_PRODUCT_BY_TIER.get(t, MONTHLY_MINUTES_PRODUCT_BY_TIER["free"]))
    sub_room = max(0.0, float(cap) - float(used_minutes))
    from_sub = min(float(est_minutes), sub_room)
    rem = float(est_minutes) - from_sub
    from_payg = min(rem, max(0.0, float(payg_avail)))
    wallet_min = max(0.0, rem - from_payg)
    return wallet_min, wallet_cents_for_overage_minutes(wallet_min)
