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
    TEXT_OUTPUT_CENTS_PER_10K_CHARS,
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


def wallet_cents_for_generated_text_chars(char_count: int) -> int:
    """按成稿字符数计费：分 / 万字（manifest），向上取整到分；字数为 0 返回 0。"""
    n = int(char_count or 0)
    if n <= 0:
        return 0
    rate = float(TEXT_OUTPUT_CENTS_PER_10K_CHARS)
    return max(1, int(math.ceil(n / 10_000.0 * rate)))


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


def estimate_billed_script_chars_upper_bound(job_type: str, payload: dict[str, Any]) -> int:
    """
    入队前预检：脚本成稿字数上界近似（与 worker 脚本阶段同一量级），用于估算文本费用。
    """
    jt = (job_type or "").strip().lower()
    if jt not in ("script_draft", "podcast_generate", "podcast"):
        return 0
    intro = str(payload.get("intro_text") or "").strip()
    outro = str(payload.get("outro_text") or str(payload.get("ending_text") or "")).strip()
    if jt in ("podcast_generate", "podcast"):
        st = normalize_script_target_input(payload.get("script_target_chars"))
        base = int(st) if st is not None else _payload_source_char_est(payload)
        base_chars = max(200, min(50_000, int(base)))
        return max(1, base_chars + len(intro) + len(outro))
    st = normalize_script_target_input(payload.get("script_target_chars"))
    body = int(st) if st is not None else 800
    body = max(200, min(50_000, body))
    return max(1, body + len(intro) + len(outro))


def preview_wallet_cents_for_text_enqueue(phone: str | None, job_type: str, payload: dict[str, Any]) -> int:
    """不修改数据库：脚本类任务入队前，超出体验包字数的预估钱包扣费（分）。"""
    if not media_wallet_billing_enabled():
        return 0
    p = (phone or "").strip()
    if not p:
        return 0
    est = estimate_billed_script_chars_upper_bound(job_type, payload if isinstance(payload, dict) else {})
    from . import models

    ex = int(models.experience_text_chars_for_phone(p) or 0)
    rest = max(0, int(est) - ex)
    return wallet_cents_for_generated_text_chars(rest)


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
    """不修改数据库：超出体验包语音分钟后，预估钱包扣费（分）；tier 已废弃保留参数。"""
    _ = tier
    if not media_wallet_billing_enabled():
        return 0
    p = (phone or "").strip()
    if not p or est_minutes <= 1e-9:
        return 0
    from . import models

    ex_m = float(models.experience_voice_minutes_for_phone(p) or 0)
    wallet_min = max(0.0, float(est_minutes) - ex_m)
    return int(wallet_cents_for_overage_minutes(wallet_min))


def split_estimated_minutes_to_wallet(
    used_minutes: float,
    tier: str | None,
    payg_avail: float,
    est_minutes: float,
) -> tuple[float, int]:
    """
    返回 (wallet_minutes, wallet_cents)。
    已取消订阅月配额与按次分钟包；参数 used_minutes / tier / payg_avail 保留兼容，不参与计算。
    """
    _ = used_minutes, tier, payg_avail
    wallet_min = max(0.0, float(est_minutes))
    return wallet_min, wallet_cents_for_overage_minutes(wallet_min)
