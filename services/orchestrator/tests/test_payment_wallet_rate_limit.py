"""钱包支付宝下单 / 异步通知进程内限流。"""

from __future__ import annotations

import pytest

from app.fyv_shared import payment_wallet_rate_limit as rl


@pytest.fixture(autouse=True)
def isolate_buckets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("FYV_WALLET_ALIPAY_CREATE_PER_PHONE_PER_MIN", raising=False)
    monkeypatch.delenv("FYV_ALIPAY_NOTIFY_PER_IP_PER_MIN", raising=False)
    with rl._lock:
        rl._phone_hits.clear()
        rl._notify_ip_hits.clear()
    yield
    with rl._lock:
        rl._phone_hits.clear()
        rl._notify_ip_hits.clear()


def test_wallet_alipay_phone_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FYV_WALLET_ALIPAY_CREATE_PER_PHONE_PER_MIN", "2")
    ok1, _ = rl.check_wallet_alipay_create_rate_limit_for_phone("13800138000")
    ok2, _ = rl.check_wallet_alipay_create_rate_limit_for_phone("13800138000")
    ok3, wait = rl.check_wallet_alipay_create_rate_limit_for_phone("13800138000")
    assert ok1 and ok2
    assert not ok3
    assert wait >= 1


def test_alipay_notify_ip_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FYV_ALIPAY_NOTIFY_PER_IP_PER_MIN", "3")
    assert rl.check_alipay_notify_rate_limit("10.0.0.1")[0]
    assert rl.check_alipay_notify_rate_limit("10.0.0.1")[0]
    assert rl.check_alipay_notify_rate_limit("10.0.0.1")[0]
    ok4, _ = rl.check_alipay_notify_rate_limit("10.0.0.1")
    assert not ok4
    assert rl.check_alipay_notify_rate_limit("10.0.0.2")[0]
