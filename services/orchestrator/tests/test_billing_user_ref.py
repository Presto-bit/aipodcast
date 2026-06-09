"""billing_user_id_from_ref 与 for_user_id 计费入口测试。"""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_billing_user_id_from_ref_accepts_uuid() -> None:
    from app.models import billing_user_id_from_ref

    uid = "00000000-0000-4000-8000-0000000000aa"
    assert billing_user_id_from_ref(uid) == uid


def test_script_text_billing_delegates_to_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.models import script_text_billing_try_debit

    uid = "00000000-0000-4000-8000-0000000000bb"
    calls: list[tuple[str, int]] = []

    def _fake(uid_in: str, chars: int):
        calls.append((uid_in, chars))
        return True, {"wallet_cents": 0, "experience_text_chars_consumed": 0}

    monkeypatch.setattr("app.models._core.script_text_billing_try_debit_for_user_id", _fake)
    ok, _ = script_text_billing_try_debit(uid, 100)
    assert ok is True
    assert calls == [(uid, 100)]


def test_preview_wallet_cents_for_media_job_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.media_wallet import preview_wallet_cents_for_media_job_user_id

    uid = "00000000-0000-4000-8000-000000000099"
    monkeypatch.setattr("app.media_wallet.media_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr("app.models.experience_voice_minutes_for_user_id", lambda _u: 10.0)
    assert preview_wallet_cents_for_media_job_user_id(uid, None, 10.0) == 0
    assert preview_wallet_cents_for_media_job_user_id(uid, None, 60.0) > 0
