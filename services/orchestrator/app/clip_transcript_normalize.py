"""将豆包 / 火山大模型录音识别 API 响应归一化为剪辑台使用的词级结构。"""

from __future__ import annotations

from typing import Any


def normalize_volc_flash_transcript(raw: dict[str, Any]) -> dict[str, Any]:
    """
    豆包录音文件识别 2.0（及火山极速版等）OpenSpeech 响应体 → 剪辑台词级结构。
    参考：https://www.volcengine.com/docs/6561/1631584
    """
    words_out: list[dict[str, Any]] = []
    wi = 0
    duration_ms: int | None = None
    ai = raw.get("audio_info")
    if isinstance(ai, dict) and ai.get("duration") is not None:
        try:
            duration_ms = int(ai["duration"])
        except (TypeError, ValueError):
            duration_ms = None
    result = raw.get("result") if isinstance(raw.get("result"), dict) else {}
    utterances = result.get("utterances")
    if not isinstance(utterances, list):
        return {"version": 1, "words": [], "duration_ms": duration_ms}

    for ut in utterances:
        if not isinstance(ut, dict):
            continue
        spk = ut.get("speaker_id")
        if spk is None:
            spk = ut.get("speaker")
        if spk is None:
            spk = 0
        try:
            spk_i = int(spk)
        except (TypeError, ValueError):
            spk_i = 0
        wlist = ut.get("words")
        if not isinstance(wlist, list):
            continue
        for w in wlist:
            if not isinstance(w, dict):
                continue
            t = str(w.get("text") or "")
            try:
                s_ms = int(w.get("start_time", 0))
                e_ms = int(w.get("end_time", s_ms))
            except (TypeError, ValueError):
                s_ms, e_ms = 0, 0
            if e_ms < s_ms:
                e_ms = s_ms
            wid = f"w{wi}"
            wi += 1
            words_out.append(
                {
                    "id": wid,
                    "speaker": spk_i,
                    "text": t,
                    "s_ms": s_ms,
                    "e_ms": e_ms,
                    "punct": "",
                }
            )

    return {"version": 1, "words": words_out, "duration_ms": duration_ms}
