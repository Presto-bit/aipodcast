from app.media_wallet import split_estimated_minutes_to_wallet, wallet_cents_for_overage_minutes
from app.subscription_manifest import MEDIA_WALLET_CENTS_PER_MINUTE


def test_wallet_cents_zero_when_no_overage():
    assert wallet_cents_for_overage_minutes(0) == 0
    assert wallet_cents_for_overage_minutes(1e-12) == 0


def test_split_subscription_then_payg_then_wallet():
    # cap 20, used 18, est 5 -> 2 from sub, 3 need from payg+wallet
    wm, cents = split_estimated_minutes_to_wallet(18.0, "free", payg_avail=2.0, est_minutes=5.0)
    assert abs(wm - 1.0) < 1e-6
    assert cents >= 1

    wm2, cents2 = split_estimated_minutes_to_wallet(18.0, "free", payg_avail=5.0, est_minutes=5.0)
    assert abs(wm2 - 0.0) < 1e-6
    assert cents2 == 0


def test_payg_tier_cap_zero_full_wallet_path():
    wm, cents = split_estimated_minutes_to_wallet(0.0, "payg", payg_avail=0.0, est_minutes=10.0)
    assert abs(wm - 10.0) < 1e-6
    assert cents == max(1, int(10 * MEDIA_WALLET_CENTS_PER_MINUTE))
