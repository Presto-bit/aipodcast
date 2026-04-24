"""支付宝异步通知：严格失败（促支付宝重试）与对账队列入队开关（环境变量）。"""

from __future__ import annotations

import os


def _truthy(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in ("1", "true", "yes", "on")


def alipay_notify_fail_on_no_checkout() -> bool:
    """无 checkout 且订单未 settled 时是否对支付宝返回 fail（500）以触发重试。默认关。"""
    return _truthy("FYV_ALIPAY_NOTIFY_FAIL_ON_NO_CHECKOUT")


def alipay_notify_fail_on_app_id_mismatch() -> bool:
    """app_id 不一致时是否返回 fail。默认关（仍记日志并入队）。"""
    return _truthy("FYV_ALIPAY_NOTIFY_FAIL_ON_APP_ID_MISMATCH")


def alipay_notify_fail_on_amount_mismatch() -> bool:
    """会话金额与通知金额不一致时是否返回 fail。默认关。"""
    return _truthy("FYV_ALIPAY_NOTIFY_FAIL_ON_AMOUNT_MISMATCH")


def payment_reconciliation_queue_enabled() -> bool:
    """是否写入 payment_reconciliation_queue。设 FYV_PAYMENT_RECONCILIATION_QUEUE_DISABLED=1 可关。"""
    return not _truthy("FYV_PAYMENT_RECONCILIATION_QUEUE_DISABLED")
