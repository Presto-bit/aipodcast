"""生产启动期安全检查。"""

import pytest

from app.startup_security import assert_production_security_or_exit


def _strong_secret() -> str:
    return "p" * 32


def test_production_ok_with_email_switches_off(monkeypatch):
    monkeypatch.setenv("FYV_PRODUCTION", "1")
    monkeypatch.setenv("INTERNAL_SIGNING_SECRET", _strong_secret())
    monkeypatch.setenv("FYV_AUTH_EMAIL_LOG_TOKEN", "0")
    monkeypatch.setenv("FYV_AUTH_EMAIL_AUTOVERIFY", "0")
    monkeypatch.delenv("PAYMENT_WEBHOOK_ALLOW_UNSIGNED", raising=False)
    assert_production_security_or_exit()


def test_production_rejects_email_log_token(monkeypatch):
    monkeypatch.setenv("FYV_PRODUCTION", "1")
    monkeypatch.setenv("INTERNAL_SIGNING_SECRET", _strong_secret())
    monkeypatch.setenv("FYV_AUTH_EMAIL_LOG_TOKEN", "1")
    monkeypatch.delenv("PAYMENT_WEBHOOK_ALLOW_UNSIGNED", raising=False)
    with pytest.raises(SystemExit) as exc:
        assert_production_security_or_exit()
    assert exc.value.code == 1


def test_production_rejects_email_autoverify(monkeypatch):
    monkeypatch.setenv("FYV_PRODUCTION", "1")
    monkeypatch.setenv("INTERNAL_SIGNING_SECRET", _strong_secret())
    monkeypatch.setenv("FYV_AUTH_EMAIL_AUTOVERIFY", "1")
    monkeypatch.delenv("PAYMENT_WEBHOOK_ALLOW_UNSIGNED", raising=False)
    with pytest.raises(SystemExit) as exc:
        assert_production_security_or_exit()
    assert exc.value.code == 1


def test_non_production_allows_log_token(monkeypatch):
    monkeypatch.delenv("FYV_PRODUCTION", raising=False)
    monkeypatch.setenv("FYV_AUTH_EMAIL_LOG_TOKEN", "1")
    assert_production_security_or_exit()
