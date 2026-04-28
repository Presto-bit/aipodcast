"""clip_transcript_normalize：词级标点与 utterance 级标点对齐。"""

from __future__ import annotations

import os

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


def test_sentence_boundary_rescore_by_pause_and_length() -> None:
    old_threshold = os.environ.get("CLIP_ASR_BOUNDARY_SCORE_THRESHOLD")
    os.environ["CLIP_ASR_BOUNDARY_SCORE_THRESHOLD"] = "0.72"
    try:
        raw = {
            "audio_info": {"duration": 5000},
            "result": {
                "utterances": [
                    {
                        "speaker_id": 0,
                        "text": "今天我们讨论模型效果此外看下优化方向",
                        "words": [
                            {"start_time": 0, "end_time": 120, "text": "今天"},
                            {"start_time": 130, "end_time": 240, "text": "我们"},
                            {"start_time": 250, "end_time": 360, "text": "讨论"},
                            {"start_time": 370, "end_time": 490, "text": "模型"},
                            {"start_time": 500, "end_time": 620, "text": "效果"},
                            {"start_time": 1250, "end_time": 1380, "text": "此外"},
                            {"start_time": 1390, "end_time": 1510, "text": "看下"},
                            {"start_time": 1520, "end_time": 1660, "text": "优化"},
                            {"start_time": 1670, "end_time": 1830, "text": "方向"},
                        ],
                    }
                ]
            },
        }
        norm = normalize_volc_flash_transcript(raw, profile="interview", speaker_hint=2)
        words = norm["words"]
        assert words[5]["text"] == "此外"
        assert words[5]["utt_new"] is True
    finally:
        if old_threshold is None:
            os.environ.pop("CLIP_ASR_BOUNDARY_SCORE_THRESHOLD", None)
        else:
            os.environ["CLIP_ASR_BOUNDARY_SCORE_THRESHOLD"] = old_threshold


def test_speaker_short_jitter_is_smoothed() -> None:
    raw = {
        "audio_info": {"duration": 2000},
        "result": {
            "utterances": [
                {
                    "speaker_id": 0,
                    "text": "我们开始",
                    "words": [
                        {"start_time": 0, "end_time": 200, "text": "我们"},
                        {"start_time": 210, "end_time": 340, "text": "开始"},
                    ],
                },
                {
                    "speaker_id": 1,
                    "text": "嗯",
                    "words": [{"start_time": 345, "end_time": 420, "text": "嗯"}],
                },
                {
                    "speaker_id": 0,
                    "text": "继续说",
                    "words": [
                        {"start_time": 430, "end_time": 560, "text": "继续"},
                        {"start_time": 570, "end_time": 760, "text": "说"},
                    ],
                },
            ]
        },
    }
    norm = normalize_volc_flash_transcript(raw)
    words = norm["words"]
    # 中间极短抖动 speaker 应被平滑回前后一致的 0
    assert words[2]["text"] == "嗯"
    assert words[2]["speaker"] == 0


def test_connector_token_avoids_cut_after_pause() -> None:
    old_threshold = os.environ.get("CLIP_ASR_BOUNDARY_SCORE_THRESHOLD")
    os.environ["CLIP_ASR_BOUNDARY_SCORE_THRESHOLD"] = "0.65"
    try:
        raw = {
            "audio_info": {"duration": 4000},
            "result": {
                "utterances": [
                    {
                        "speaker_id": 0,
                        "text": "我们先看现状然后再给方案",
                        "words": [
                            {"start_time": 0, "end_time": 180, "text": "我们"},
                            {"start_time": 190, "end_time": 350, "text": "先看"},
                            {"start_time": 360, "end_time": 520, "text": "现状"},
                            {"start_time": 1150, "end_time": 1280, "text": "然后"},
                            {"start_time": 1290, "end_time": 1460, "text": "再给"},
                            {"start_time": 1470, "end_time": 1650, "text": "方案"},
                        ],
                    }
                ]
            },
        }
        norm = normalize_volc_flash_transcript(raw, profile="monologue", speaker_hint=1)
        words = norm["words"]
        assert words[3]["text"] == "然后"
        assert words[3]["utt_new"] is False
    finally:
        if old_threshold is None:
            os.environ.pop("CLIP_ASR_BOUNDARY_SCORE_THRESHOLD", None)
        else:
            os.environ["CLIP_ASR_BOUNDARY_SCORE_THRESHOLD"] = old_threshold


def test_quote_unclosed_blocks_cut() -> None:
    raw = {
        "audio_info": {"duration": 4500},
        "result": {
            "utterances": [
                {
                    "speaker_id": 0,
                    "text": "他说“今天先发版 明天再回滚”大家都同意",
                    "words": [
                        {"start_time": 0, "end_time": 180, "text": "他说“"},
                        {"start_time": 190, "end_time": 320, "text": "今天"},
                        {"start_time": 330, "end_time": 470, "text": "先发版"},
                        {"start_time": 900, "end_time": 1020, "text": "明天"},
                        {"start_time": 1030, "end_time": 1200, "text": "再回滚”"},
                        {"start_time": 1210, "end_time": 1390, "text": "大家"},
                        {"start_time": 1400, "end_time": 1580, "text": "都同意"},
                    ],
                }
            ]
        },
    }
    norm = normalize_volc_flash_transcript(raw, profile="monologue", speaker_hint=1)
    words = norm["words"]
    assert words[3]["text"] == "明天"
    assert words[3]["utt_new"] is False
