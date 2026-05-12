from app.tts_pipeline import normalize_dialogue_speaker_lines


def test_speaker3_maps_to_alternating_12():
    raw = "Speaker3: 第三视角\nSpeaker4: 第四句\nSpeaker1: 正常\n"
    out = normalize_dialogue_speaker_lines(raw)
    assert "Speaker2: 第三视角" in out
    assert "Speaker1: 第四句" in out
    assert "Speaker1: 正常" in out


def test_speaker5_maps_to_two():
    assert "Speaker2: hi" in normalize_dialogue_speaker_lines("Speaker5: hi")
