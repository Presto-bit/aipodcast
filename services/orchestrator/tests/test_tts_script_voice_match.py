from app.tts_script_voice_match import (
    adjust_minimax_default_voices_for_script,
    infer_mono_gender_hint,
)
from app.legacy_bridge import default_minimax_podcast_voice_ids


def test_infer_female_bias():
    s = "她是一位作家。" * 30 + "她的观点很清晰。"
    assert infer_mono_gender_hint(s) == "female"


def test_infer_male_bias():
    s = "他是一位工程师。" * 30 + "他认为问题出在架构。"
    assert infer_mono_gender_hint(s) == "male"


def test_infer_short_returns_none():
    assert infer_mono_gender_hint("他很好。") is None


def test_adjust_single_swaps_default_max_to_mini_when_female():
    mini, maxv = default_minimax_podcast_voice_ids()
    nv, v1, v2, tag = adjust_minimax_default_voices_for_script(
        main_body=("她" * 200) + "她的世界",
        tts_mode="single",
        voice_id=maxv,
        voice_id_1=mini,
        voice_id_2=maxv,
        def_mini=mini,
        def_max=maxv,
    )
    assert nv == mini
    assert tag == "single_default_voice_gender"


def test_adjust_single_skips_custom_voice():
    mini, maxv = default_minimax_podcast_voice_ids()
    custom = "custom_voice_id_123"
    nv, _, _, tag = adjust_minimax_default_voices_for_script(
        main_body=("她" * 200) + "她的世界",
        tts_mode="single",
        voice_id=custom,
        voice_id_1=mini,
        voice_id_2=maxv,
        def_mini=mini,
        def_max=maxv,
    )
    assert nv == custom
    assert tag is None
