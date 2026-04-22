"""clip_transcript_normalize：词级标点与 utterance 级标点对齐。"""

from __future__ import annotations

from app.clip_transcript_normalize import normalize_volc_flash_transcript


def test_volc_doc_example_trailing_comma_and_period_on_last_chars() -> None:
    """6561/1354868 文档示例：标点仅在 utterance.text，词级为单字无标点。"""
    raw = {
        "audio_info": {"duration": 10000},
        "result": {
            "text": "这是字节跳动， 今日头条母公司。",
            "utterances": [
                {
                    "definite": True,
                    "end_time": 1705,
                    "start_time": 0,
                    "text": "这是字节跳动，",
                    "words": [
                        {"blank_duration": 0, "end_time": 860, "start_time": 740, "text": "这"},
                        {"blank_duration": 0, "end_time": 1020, "start_time": 860, "text": "是"},
                        {"blank_duration": 0, "end_time": 1200, "start_time": 1020, "text": "字"},
                        {"blank_duration": 0, "end_time": 1400, "start_time": 1200, "text": "节"},
                        {"blank_duration": 0, "end_time": 1560, "start_time": 1400, "text": "跳"},
                        {"blank_duration": 0, "end_time": 1640, "start_time": 1560, "text": "动"},
                    ],
                },
                {
                    "definite": True,
                    "end_time": 3696,
                    "start_time": 2110,
                    "text": "今日头条母公司。",
                    "words": [
                        {"blank_duration": 0, "end_time": 3070, "start_time": 2910, "text": "今"},
                        {"blank_duration": 0, "end_time": 3230, "start_time": 3070, "text": "日"},
                        {"blank_duration": 0, "end_time": 3390, "start_time": 3230, "text": "头"},
                        {"blank_duration": 0, "end_time": 3550, "start_time": 3390, "text": "条"},
                        {"blank_duration": 0, "end_time": 3670, "start_time": 3550, "text": "母"},
                        {"blank_duration": 0, "end_time": 3696, "start_time": 3670, "text": "公"},
                        {"blank_duration": 0, "end_time": 3696, "start_time": 3696, "text": "司"},
                    ],
                },
            ],
        },
    }
    norm = normalize_volc_flash_transcript(raw)
    words = norm["words"]
    assert words[5]["text"] == "动"
    assert "，" in words[5]["punct"]
    assert words[-1]["text"] == "司"
    assert "。" in words[-1]["punct"]


def test_middle_comma_between_chars() -> None:
    raw = {
        "audio_info": {"duration": 1000},
        "result": {
            "utterances": [
                {
                    "speaker_id": 0,
                    "start_time": 0,
                    "end_time": 900,
                    "text": "你好，世界",
                    "words": [
                        {"start_time": 0, "end_time": 100, "text": "你"},
                        {"start_time": 100, "end_time": 200, "text": "好"},
                        {"start_time": 300, "end_time": 400, "text": "世"},
                        {"start_time": 400, "end_time": 500, "text": "界"},
                    ],
                }
            ]
        },
    }
    norm = normalize_volc_flash_transcript(raw)
    words = norm["words"]
    assert words[1]["text"] == "好"
    assert "，" in words[1]["punct"]
