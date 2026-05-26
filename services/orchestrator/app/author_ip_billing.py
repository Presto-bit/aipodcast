"""个人特色 IP 成文：对齐现网 script_text 体验包 + 钱包扣费。"""
from __future__ import annotations

from typing import Any

from .media_wallet import media_wallet_billing_enabled, wallet_cents_for_generated_text_chars
from .models import (
    experience_text_chars_for_phone,
    script_text_billing_try_debit,
    wallet_balance_cents_for_phone,
)


def can_afford_author_compose(phone: str | None, char_count: int) -> tuple[bool, str | None, dict[str, Any]]:
    """预检是否可覆盖预估字数（不扣费）。"""
    meta: dict[str, Any] = {"estimatedChars": int(char_count or 0), "walletCents": 0}
    if not media_wallet_billing_enabled():
        return True, None, meta
    p = (phone or "").strip()
    n = max(0, int(char_count or 0))
    if not p:
        return False, "未登录", meta
    if n <= 0:
        return True, None, meta
    ex = int(experience_text_chars_for_phone(p) or 0)
    rest = max(0, n - ex)
    cents = int(wallet_cents_for_generated_text_chars(rest))
    meta["experienceCharsRemaining"] = ex
    meta["walletCents"] = cents
    if cents <= 0:
        return True, None, meta
    bal = int(wallet_balance_cents_for_phone(p) or 0)
    if bal < cents:
        return (
            False,
            f"预估约 {n} 字，超出体验包后需从钱包扣约 ¥{cents / 100:.2f}，当前余额不足，请先充值。",
            {**meta, "walletBalanceCents": bal, "reason": "insufficient_wallet"},
        )
    return True, None, {**meta, "walletBalanceCents": bal}


def debit_author_compose(phone: str | None, char_count: int) -> tuple[bool, str | None, dict[str, Any]]:
    """成文成功后按实际字数扣费。"""
    if not media_wallet_billing_enabled():
        return True, None, {}
    p = (phone or "").strip()
    n = int(char_count or 0)
    if not p or n <= 0:
        return True, None, {}
    ok, meta = script_text_billing_try_debit(p, n)
    if not ok:
        msg = str((meta or {}).get("message") or "扣费失败")
        return False, msg, meta if isinstance(meta, dict) else {}
    return True, None, meta if isinstance(meta, dict) else {}
