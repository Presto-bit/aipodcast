"""预授权 hold 计算与语音分钟取整。"""

from app.billing_preauth import (
    preview_script_preauth_wallet_cents,
    preview_voice_preauth_wallet_cents,
    round_voice_billed_minutes,
    voice_hold_minutes,
)


def test_voice_hold_minutes_buffered_and_capped() -> None:
    est = 10.0
    hold = voice_hold_minutes(est)
    assert hold >= est * 1.2 - 1e-9
    assert hold <= min(est * 1.5, est + 3.0) + 1e-9


def test_round_voice_billed_minutes_granularity() -> None:
    assert round_voice_billed_minutes(0.0) == 0.0
    assert round_voice_billed_minutes(0.05) == 0.1
    assert round_voice_billed_minutes(1.01) == 1.1


def test_preview_voice_preauth_uses_experience_first() -> None:
    hold, cents = preview_voice_preauth_wallet_cents(15.0, 10.0)
    assert hold >= 10.0
    assert cents == 0


def test_preview_script_preauth_wallet_cents() -> None:
    assert preview_script_preauth_wallet_cents(5000, 3000) == 0
    cents = preview_script_preauth_wallet_cents(0, 20_000)
    assert cents > 0
