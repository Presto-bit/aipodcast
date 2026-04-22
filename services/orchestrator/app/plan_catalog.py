"""
订阅「套餐」公开 API 组装。

会员收银已下线；``/api/v1/subscription/plans`` 与钱包价目共用 ``billing_catalog``，
权益与数值仍以 ``subscription_manifest`` 为单一来源。
"""

from __future__ import annotations

from typing import Any

from .billing_catalog import (
    build_wallet_catalog_response,
    is_valid_wallet_topup_amount_cents,
)

__all__ = [
    "build_subscription_plans_response",
    "is_valid_wallet_topup_amount_cents",
]


def build_subscription_plans_response() -> dict[str, Any]:
    """兼容 GET /api/v1/subscription/plans：返回钱包充值与用量参考。"""
    return build_wallet_catalog_response()
