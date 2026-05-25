"""播客成片不单独扣文稿费；仅 script_draft 等按万字预检。"""

from app.media_wallet import (
    estimate_billed_script_chars_upper_bound,
    preview_wallet_cents_for_text_enqueue,
    script_text_billed_separately_for_job_type,
)


def test_script_text_billed_separately_job_types() -> None:
    assert script_text_billed_separately_for_job_type("script_draft") is True
    assert script_text_billed_separately_for_job_type("podcast_generate") is False
    assert script_text_billed_separately_for_job_type("podcast") is False


def test_estimate_script_chars_zero_for_podcast() -> None:
    payload = {"script_target_chars": 8000, "intro_text": "开场", "outro_text": "收场"}
    assert estimate_billed_script_chars_upper_bound("podcast_generate", payload) == 0
    assert estimate_billed_script_chars_upper_bound("podcast", payload) == 0
    assert estimate_billed_script_chars_upper_bound("script_draft", payload) > 0


def test_preview_text_wallet_cents_zero_for_podcast(monkeypatch) -> None:
    monkeypatch.setenv("MEDIA_WALLET_BILLING_ENABLED", "1")
    payload = {"script_target_chars": 20_000}
    assert preview_wallet_cents_for_text_enqueue("13800138000", "podcast_generate", payload) == 0
