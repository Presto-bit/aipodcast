"""新用户体验包：剪辑 ASR 先扣转写分钟再扣钱包。"""

from __future__ import annotations

import contextlib
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest


@contextlib.contextmanager
def _fake_cursor(_conn):
    yield _CUR


_CUR = MagicMock()


def test_asr_billing_consumes_experience_before_wallet() -> None:
    from app.models import asr_billing_try_debit_for_user_id

    uid = "00000000-0000-4000-8000-000000000001"
    row = {"asr_minutes_remaining": Decimal("20.0")}
    _CUR.fetchone.side_effect = [{"id": uid}, row]

    with (
        patch("app.media_wallet.media_wallet_billing_enabled", return_value=True),
        patch("app.models._core.ensure_user_experience_balance_schema"),
        patch("app.models._core.ensure_user_wallet_schema"),
        patch("app.models._core.get_conn") as mock_conn,
        patch("app.models._core.get_cursor", _fake_cursor),
        patch("app.media_wallet.wallet_cents_for_asr_audio_seconds", return_value=490) as mock_cents,
        patch("app.models._core._phone_for_user_id_on_cur", return_value="13800138000"),
    ):
        mock_conn.return_value.__enter__.return_value = MagicMock()
        ok, meta = asr_billing_try_debit_for_user_id(uid, 600.0)  # 10 分钟

    assert ok is True
    assert meta["wallet_cents"] == 0
    assert meta["experience_asr_minutes_consumed"] == pytest.approx(10.0)
    mock_cents.assert_not_called()
    update_sql = _CUR.execute.call_args_list[1][0][0]
    assert "asr_minutes_remaining" in update_sql


def test_asr_billing_wallet_when_experience_exhausted() -> None:
    from app.models import asr_billing_try_debit_for_user_id

    uid = "00000000-0000-4000-8000-000000000001"
    row = {"asr_minutes_remaining": Decimal("0")}
    _CUR.reset_mock()
    _CUR.fetchone.side_effect = [{"id": uid}, row, {"balance_cents": 10_000}]

    with (
        patch("app.media_wallet.media_wallet_billing_enabled", return_value=True),
        patch("app.models._core.ensure_user_experience_balance_schema"),
        patch("app.models._core.ensure_user_wallet_schema"),
        patch("app.models._core.get_conn") as mock_conn,
        patch("app.models._core.get_cursor", _fake_cursor),
        patch("app.media_wallet.wallet_cents_for_asr_audio_seconds", return_value=245),
        patch("app.models._core._insert_user_wallet_ledger"),
        patch("app.models._core._phone_for_user_id_on_cur", return_value="13800138000"),
    ):
        mock_conn.return_value.__enter__.return_value = MagicMock()
        ok, meta = asr_billing_try_debit_for_user_id(uid, 1800.0)  # 30 分钟

    assert ok is True
    assert meta["wallet_cents"] == 245
    assert meta["experience_asr_minutes_consumed"] == 0.0


def test_preview_wallet_cents_for_asr_transcribe_respects_experience(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.media_wallet import preview_wallet_cents_for_asr_transcribe

    monkeypatch.setattr("app.media_wallet.media_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr("app.models.experience_asr_minutes_for_phone", lambda _p: 20.0)
    monkeypatch.setattr("app.media_wallet.wallet_cents_for_asr_audio_seconds", lambda sec: int(sec))

    assert preview_wallet_cents_for_asr_transcribe("13800138000", 600.0) == 0
    assert preview_wallet_cents_for_asr_transcribe("13800138000", 3600.0) == 2400


def test_preview_wallet_cents_for_asr_transcribe_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.media_wallet import preview_wallet_cents_for_asr_transcribe_user_id

    uid = "00000000-0000-4000-8000-000000000099"
    monkeypatch.setattr("app.media_wallet.media_wallet_billing_enabled", lambda: True)
    monkeypatch.setattr("app.models.experience_asr_minutes_for_user_id", lambda _u: 15.0)
    monkeypatch.setattr("app.media_wallet.wallet_cents_for_asr_audio_seconds", lambda sec: int(sec))

    assert preview_wallet_cents_for_asr_transcribe_user_id(uid, 600.0) == 0
    assert preview_wallet_cents_for_asr_transcribe_user_id(uid, 3600.0) == 2700
