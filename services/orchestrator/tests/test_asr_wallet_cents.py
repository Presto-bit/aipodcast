"""ASR 钱包单价（分/小时）与按秒折算。"""

import os


def test_wallet_cents_for_asr_audio_seconds_default_hourly_rate(monkeypatch) -> None:
    monkeypatch.delenv("ASR_WALLET_CENTS_PER_AUDIO_HOUR", raising=False)
    from app.media_wallet import wallet_cents_for_asr_audio_seconds

    assert wallet_cents_for_asr_audio_seconds(0) == 0
    assert wallet_cents_for_asr_audio_seconds(-1) == 0
    # 1 秒：ceil(1/3600 * 490) = 1 分
    assert wallet_cents_for_asr_audio_seconds(1) == 1
    # 整小时
    assert wallet_cents_for_asr_audio_seconds(3600) == 490
    # 半小时
    assert wallet_cents_for_asr_audio_seconds(1800) == 245


def test_wallet_cents_env_override(monkeypatch) -> None:
    monkeypatch.setenv("ASR_WALLET_CENTS_PER_AUDIO_HOUR", "600")
    import importlib

    mw = importlib.reload(importlib.import_module("app.media_wallet"))
    assert mw.wallet_cents_for_asr_audio_seconds(3600) == 600
