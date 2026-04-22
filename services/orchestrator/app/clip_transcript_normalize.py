"""将豆包 / 火山大模型录音识别 API 响应归一化为剪辑台使用的词级结构。"""

from __future__ import annotations

import unicodedata
from typing import Any

# 词末可拆入 punct 的符号（便于前端按句末标点分行；避免把字母数字尾部误拆）
_TRAIL_PUNCT_CHARS = frozenset(
    "。！？，、；：…,.!?;:\"\"''（）()【】[]「」『』《》·—－"
)


def _is_insertable_between_chars(ch: str) -> bool:
    """utterance 级 text 相对词级拼接多出的间隔符（逗号、引号等），可挂到前一或首词。"""
    if not ch or ch.isspace() or ch == "\u3000":
        return False
    if ch in _TRAIL_PUNCT_CHARS:
        return True
    cat = unicodedata.category(ch)
    return cat.startswith("P")


def _utterance_level_punct_extras(utterance_text: str, wlist: list[Any]) -> dict[int, str]:
    """
    火山文档示例：utterances[].text 含「，。」等标点，而 words[].text 常为单字且无标点。
    将 utterance 文本与词级 text 按字符对齐，把多出的标点挂到对应词（句末挂末词，句中挂前一词）。
    """
    extras: dict[int, str] = {}
    chars: list[tuple[str, int]] = []
    for wi, w in enumerate(wlist):
        if not isinstance(w, dict):
            continue
        for ch in str(w.get("text") or ""):
            chars.append((ch, wi))

    U = str(utterance_text or "")
    if not U.strip() or not chars:
        return extras

    ptr = 0
    i = 0
    while i < len(U):
        c = U[i]
        if c.isspace() or c == "\u3000":
            i += 1
            continue
        if ptr < len(chars) and c == chars[ptr][0]:
            ptr += 1
            i += 1
            continue
        if _is_insertable_between_chars(c):
            if ptr == 0:
                wi0 = chars[0][1]
                extras[wi0] = extras.get(wi0, "") + c
            else:
                prev_wi = chars[ptr - 1][1]
                extras[prev_wi] = extras.get(prev_wi, "") + c
            i += 1
            continue
        # 非标点字符不一致（如 ITN 与词级文本不一致）：放弃对齐，改用语级前缀后缀兜底
        ptr = -1
        break

    if ptr == len(chars) and i < len(U):
        tail = "".join(x for x in U[i:] if not x.isspace() and x != "\u3000")
        if tail:
            lw = chars[-1][1]
            extras[lw] = extras.get(lw, "") + tail

    if ptr != len(chars):
        extras.clear()
        raw_concat = "".join(str(w.get("text") or "") for w in wlist if isinstance(w, dict))
        ut_ns = "".join(x for x in U if not x.isspace() and x != "\u3000")
        raw_ns = "".join(x for x in raw_concat if not x.isspace() and x != "\u3000")
        if raw_ns and ut_ns.startswith(raw_ns) and len(ut_ns) > len(raw_ns):
            suf = ut_ns[len(raw_ns) :]
            lw = chars[-1][1]
            extras[lw] = suf

    return extras


def _split_word_text_and_trailing_punct(raw: str) -> tuple[str, str]:
    """ASR 常把标点粘在 text 尾部；拆出 punct 供前端 displayToken 与句边界判断。"""
    s = str(raw or "")
    if not s.strip():
        return s, ""
    j = len(s)
    while j > 0:
        ch = s[j - 1]
        if ch.isspace():
            j -= 1
            continue
        if ch in _TRAIL_PUNCT_CHARS or unicodedata.category(ch).startswith("P"):
            j -= 1
            continue
        break
    body, trail = s[:j], s[j:]
    return body.strip(), trail.strip()


def _speaker_canonical_index(raw_spk: Any, order: list[int]) -> int:
    """
    将 ASR 返回的 speaker / speaker_id 映射为从 0 递增的索引，保证双人对话为 0、1
    （对应前端 Host / Guest）。部分服务返回 1、2 或跳号，直接用作下标会错显示为 S3 等。
    """
    try:
        x = int(raw_spk)
    except (TypeError, ValueError):
        x = 0
    if x not in order:
        order.append(x)
    return order.index(x)


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

    speaker_order: list[int] = []
    for ut in utterances:
        if not isinstance(ut, dict):
            continue
        spk = ut.get("speaker_id")
        if spk is None:
            spk = ut.get("speaker")
        if spk is None:
            spk = 0
        _speaker_canonical_index(spk, speaker_order)

    utt_processed = 0
    for ut in utterances:
        if not isinstance(ut, dict):
            continue
        spk = ut.get("speaker_id")
        if spk is None:
            spk = ut.get("speaker")
        if spk is None:
            spk = 0
        spk_i = _speaker_canonical_index(spk, speaker_order)
        wlist = ut.get("words")
        if not isinstance(wlist, list):
            continue
        utt_extras = _utterance_level_punct_extras(str(ut.get("text") or ""), wlist)
        n_words_before = len(words_out)
        for wii, w in enumerate(wlist):
            if not isinstance(w, dict):
                continue
            t_raw = str(w.get("text") or "")
            body, trail_p = _split_word_text_and_trailing_punct(t_raw)
            extra = str(w.get("punctuation") or w.get("punc") or "").strip()
            utt_x = str(utt_extras.get(wii) or "").strip()
            punct = (trail_p + extra + utt_x).strip()
            t = body if body else t_raw.strip()
            if not t and punct:
                t = punct
                punct = ""
            try:
                s_ms = int(w.get("start_time", 0))
                e_ms = int(w.get("end_time", s_ms))
            except (TypeError, ValueError):
                s_ms, e_ms = 0, 0
            if e_ms < s_ms:
                e_ms = s_ms
            wid = f"w{wi}"
            wi += 1
            utt_new = bool(utt_processed > 0 and wii == 0)
            words_out.append(
                {
                    "id": wid,
                    "speaker": spk_i,
                    "text": t,
                    "s_ms": s_ms,
                    "e_ms": e_ms,
                    "punct": punct,
                    "utt_new": utt_new,
                }
            )
        if len(words_out) > n_words_before:
            utt_processed += 1

    return {"version": 1, "words": words_out, "duration_ms": duration_ms}
