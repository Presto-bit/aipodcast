from app.tts_pipeline import normalize_dialogue_speaker_lines, parse_tts_dialogue_lines


def test_speaker3_maps_to_alternating_12():
    raw = "Speaker3: 第三视角\nSpeaker4: 第四句\nSpeaker1: 正常\n"
    out = normalize_dialogue_speaker_lines(raw)
    assert "Speaker2: 第三视角" in out
    assert "Speaker1: 第四句" in out
    assert "Speaker1: 正常" in out


def test_speaker5_maps_to_two():
    assert "Speaker2: hi" in normalize_dialogue_speaker_lines("Speaker5: hi")


def test_inline_two_speakers_on_one_physical_line_splits_for_tts():
    raw = "Speaker2: 晚安，好梦。Speaker1: 等一下，先别急着睡。"
    out = normalize_dialogue_speaker_lines(raw)
    lines = [x for x in out.split("\n") if x.strip()]
    assert len(lines) == 2
    assert lines[0].startswith("Speaker2:")
    assert "好梦" in lines[0]
    assert lines[1].startswith("Speaker1:")
    assert "等一下" in lines[1]
    segs = parse_tts_dialogue_lines(raw)
    assert len(segs) == 2
    assert segs[0] == ("2", "晚安，好梦。")
    assert segs[1][0] == "1" and "等一下" in segs[1][1]
