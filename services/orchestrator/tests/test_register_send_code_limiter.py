"""注册发码 IP 限流（进程内）。"""

import pytest

from app.fyv_shared import register_send_code_limiter as lim


@pytest.fixture(autouse=True)
def isolate_limiter(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FYV_AUTH_REGISTER_SEND_CODE_PER_IP_PER_MIN", "3")
    monkeypatch.setenv("FYV_AUTH_REGISTER_RATE_REDIS", "0")
    with lim._lock:
        lim._buckets.clear()
        lim._redis_cli = None
        lim._redis_checked = False
    yield
    with lim._lock:
        lim._buckets.clear()
        lim._redis_cli = None
        lim._redis_checked = False


def test_allows_under_limit() -> None:
    assert lim.check_register_send_code_rate_limit("1.2.3.4") == (True, 0)
    assert lim.check_register_send_code_rate_limit("1.2.3.4") == (True, 0)
    assert lim.check_register_send_code_rate_limit("1.2.3.4") == (True, 0)


def test_blocks_over_limit() -> None:
    assert lim.check_register_send_code_rate_limit("10.0.0.1") == (True, 0)
    assert lim.check_register_send_code_rate_limit("10.0.0.1") == (True, 0)
    assert lim.check_register_send_code_rate_limit("10.0.0.1") == (True, 0)
    ok, wait = lim.check_register_send_code_rate_limit("10.0.0.1")
    assert ok is False
    assert wait >= 1


def test_disabled_when_env_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FYV_AUTH_REGISTER_SEND_CODE_PER_IP_PER_MIN", "0")
    with lim._lock:
        lim._buckets.clear()
    for _ in range(20):
        assert lim.check_register_send_code_rate_limit("8.8.8.8") == (True, 0)
