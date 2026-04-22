from app.media_wallet import (
    split_estimated_minutes_to_wallet,
    wallet_cents_for_generated_text_chars,
    wallet_cents_for_overage_minutes,
)
from app.subscription_manifest import MEDIA_WALLET_CENTS_PER_MINUTE


def test_wallet_cents_zero_when_no_overage():
    assert wallet_cents_for_overage_minutes(0) == 0
    assert wallet_cents_for_overage_minutes(1e-12) == 0


def test_split_estimated_minutes_wallet_only_path():
    wm, cents = split_estimated_minutes_to_wallet(0.0, "free", payg_avail=0.0, est_minutes=10.0)
    assert abs(wm - 10.0) < 1e-6
    assert cents == max(1, int(10 * MEDIA_WALLET_CENTS_PER_MINUTE))


def test_wallet_cents_for_generated_text_chars():
    assert wallet_cents_for_generated_text_chars(0) == 0
    assert wallet_cents_for_generated_text_chars(10_000) == 100
    assert wallet_cents_for_generated_text_chars(1) >= 1
