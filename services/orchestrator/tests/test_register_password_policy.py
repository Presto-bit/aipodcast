"""注册密码策略单元测试。"""

import pytest

from app.fyv_shared.auth_service import _register_password_strength_err


def test_rejects_common_weak_password() -> None:
    assert _register_password_strength_err("123456") is not None
    assert _register_password_strength_err("password") is not None


def test_accepts_reasonable_password() -> None:
    assert _register_password_strength_err("k9_mX.qwN42") is None


def test_rejects_email_local_part_in_password() -> None:
    err = _register_password_strength_err("myuser_x9_extra", email="myuser@example.com", username="someone")
    assert err is not None


def test_rejects_username_in_password() -> None:
    err = _register_password_strength_err("prefix_alice_suffix", username="alice")
    assert err is not None


def test_strict_off_only_length(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FYV_AUTH_STRICT_PASSWORD", "0")
    assert _register_password_strength_err("123456") is None
    assert _register_password_strength_err("x" * 200) is not None
