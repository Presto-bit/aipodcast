"""
计费用户引用统一入口（P2）：``user_ref`` 可为 UUID / 手机 / 邮箱 / 用户名。

新代码请优先使用本模块 ``*_for_user_ref``；底层表主键均为 ``users.id``。
"""

from __future__ import annotations

from .models._core import (
    billing_user_id_from_created_by,
    billing_user_id_from_ref,
    experience_asr_minutes_for_user_id,
    experience_pack_row_exists_for_user_id,
    experience_text_chars_for_user_id,
    experience_voice_minutes_for_user_id,
    media_billing_try_assert_cover_estimated_minutes_for_user_id,
    media_billing_try_debit_actual_minutes_for_user_id,
    script_text_billing_refund_for_user_id,
    script_text_billing_try_debit_for_user_id,
    wallet_balance_cents_for_user_id,
    wallet_credit_cents_for_user_id,
    wallet_try_debit_cents_for_user_id,
)

__all__ = [
    "billing_user_id_from_created_by",
    "billing_user_id_from_ref",
    "experience_asr_minutes_for_user_ref",
    "experience_pack_row_exists_for_user_ref",
    "experience_text_chars_for_user_ref",
    "experience_voice_minutes_for_user_ref",
    "media_billing_try_assert_cover_estimated_minutes_for_user_ref",
    "media_billing_try_debit_actual_minutes_for_user_ref",
    "script_text_billing_refund_for_user_ref",
    "script_text_billing_try_debit_for_user_ref",
    "wallet_balance_cents_for_user_ref",
    "wallet_credit_cents_for_user_ref",
    "wallet_try_debit_cents_for_user_ref",
]


def wallet_balance_cents_for_user_ref(user_ref: str) -> int:
    uid = billing_user_id_from_ref(user_ref)
    return wallet_balance_cents_for_user_id(uid) if uid else 0


def experience_voice_minutes_for_user_ref(user_ref: str) -> float:
    uid = billing_user_id_from_ref(user_ref)
    return experience_voice_minutes_for_user_id(uid) if uid else 0.0


def experience_asr_minutes_for_user_ref(user_ref: str) -> float:
    uid = billing_user_id_from_ref(user_ref)
    return experience_asr_minutes_for_user_id(uid) if uid else 0.0


def experience_text_chars_for_user_ref(user_ref: str) -> int:
    uid = billing_user_id_from_ref(user_ref)
    return experience_text_chars_for_user_id(uid) if uid else 0


def experience_pack_row_exists_for_user_ref(user_ref: str) -> bool:
    uid = billing_user_id_from_ref(user_ref)
    return experience_pack_row_exists_for_user_id(uid) if uid else False


def wallet_try_debit_cents_for_user_ref(user_ref: str, cents: int) -> tuple[bool, int]:
    uid = billing_user_id_from_ref(user_ref)
    if not uid:
        return False, -1
    return wallet_try_debit_cents_for_user_id(uid, cents)


def wallet_credit_cents_for_user_ref(user_ref: str, cents: int) -> bool:
    uid = billing_user_id_from_ref(user_ref)
    if not uid:
        return False
    return wallet_credit_cents_for_user_id(uid, cents)


def script_text_billing_try_debit_for_user_ref(user_ref: str, char_count: int):
    uid = billing_user_id_from_ref(user_ref)
    if not uid:
        return False, {"wallet_cents": 0, "experience_text_chars_consumed": 0, "reason": "no_user", "message": "未找到账户"}
    return script_text_billing_try_debit_for_user_id(uid, char_count)


def script_text_billing_refund_for_user_ref(user_ref: str, meta: dict) -> None:
    uid = billing_user_id_from_ref(user_ref)
    if uid:
        script_text_billing_refund_for_user_id(uid, meta)


def media_billing_try_assert_cover_estimated_minutes_for_user_ref(
    user_ref: str,
    tier: str | None,
    est_minutes: float,
    *,
    period_days: int = 30,
):
    uid = billing_user_id_from_ref(user_ref)
    if not uid:
        return True, {"estimated_minutes": float(est_minutes)}
    return media_billing_try_assert_cover_estimated_minutes_for_user_id(
        uid, tier, est_minutes, period_days=period_days
    )


def media_billing_try_debit_actual_minutes_for_user_ref(
    user_ref: str,
    tier: str | None,
    actual_minutes: float,
    *,
    period_days: int = 30,
):
    uid = billing_user_id_from_ref(user_ref)
    if not uid:
        base = {
            "payg_restores": [],
            "wallet_cents": 0,
            "from_payg_minutes": 0.0,
            "experience_voice_minutes_consumed": 0.0,
        }
        return False, 0, {**base, "reason": "no_user", "message": "未找到账户，无法结算语音用量"}
    return media_billing_try_debit_actual_minutes_for_user_id(
        uid, tier, actual_minutes, period_days=period_days
    )
