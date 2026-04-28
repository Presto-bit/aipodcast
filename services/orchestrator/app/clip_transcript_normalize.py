"""将豆包 / 火山大模型录音识别 API 响应归一化为剪辑台使用的词级结构。"""

from __future__ import annotations

import unicodedata
import os
from typing import Any

# 词末可拆入 punct 的符号（便于前端按句末标点分行；避免把字母数字尾部误拆）
_TRAIL_PUNCT_CHARS = frozenset(
    "。！？，、；：…,.!?;:\"\"''（）()【】[]「」『』《》·—－"
)
_SENT_END_PUNCT = frozenset("。！？!?…")
_CLAUSE_PUNCT = frozenset("，,、；;：:")
_CONNECTOR_TOKENS = frozenset(
    ("然后", "所以", "但是", "因为", "而且", "就是", "其实", "并且", "不过", "另外", "同时")
)
_FILLER_TOKENS = frozenset(("嗯", "啊", "哦", "呃", "诶", "哎", "对", "好", "是的"))
_ENUM_START_TOKENS = frozenset(("第一", "第二", "第三", "第四", "第五", "首先", "其次", "最后", "一是", "二是", "三是"))


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


def _word_confidence(w: dict[str, Any]) -> float:
    """统一抽取词置信度，缺失时返回中性值。"""
    for k in ("confidence", "conf", "probability"):
        v = w.get(k)
        try:
            if v is None:
                continue
            f = float(v)
            if 0.0 <= f <= 1.0:
                return f
            if f > 1.0:
                return min(1.0, f / 100.0)
        except (TypeError, ValueError):
            continue
    return 0.6


def _speaker_smooth(words: list[dict[str, Any]], *, min_switch_ms: int) -> None:
    """
    平滑 speaker 抖动：A-B-A 且 B 持续极短时并回 A。
    仅改标签，不改原始音频与时间戳。
    """
    if len(words) < 3:
        return
    for i in range(1, len(words) - 1):
        prev_sp = words[i - 1].get("speaker")
        cur_sp = words[i].get("speaker")
        nxt_sp = words[i + 1].get("speaker")
        if prev_sp != nxt_sp or cur_sp == prev_sp:
            continue
        dur = int(words[i].get("e_ms", 0)) - int(words[i].get("s_ms", 0))
        if dur <= max(50, min_switch_ms):
            words[i]["speaker"] = prev_sp


def _boundary_score(
    *,
    prev_word: dict[str, Any],
    cur_word: dict[str, Any],
    line_len_chars: int,
    line_dur_ms: int,
    min_pause_ms: int,
) -> float:
    """
    句边界融合打分：
    - 停顿
    - 末标点
    - 说话人切换
    - 置信度下降
    - 句长兜底
    """
    pause_ms = max(0, int(cur_word.get("s_ms", 0)) - int(prev_word.get("e_ms", 0)))
    prev_tail = str(prev_word.get("punct") or "").strip()
    prev_conf = float(prev_word.get("conf", 0.6))
    cur_conf = float(cur_word.get("conf", 0.6))
    score = 0.0

    if pause_ms >= min_pause_ms:
        score += min(0.85, 0.55 + (pause_ms - min_pause_ms) / 1200.0)
    if any(ch in _SENT_END_PUNCT for ch in prev_tail):
        score += 0.7
    elif any(ch in _CLAUSE_PUNCT for ch in prev_tail):
        score += 0.25
    if prev_word.get("speaker") != cur_word.get("speaker"):
        score += 0.45
    if prev_conf - cur_conf >= 0.28:
        score += 0.2
    if line_len_chars >= 42:
        score += 0.28
    if line_dur_ms >= 7200:
        score += 0.25
    return score


def _looks_like_numeric_or_time_unit(t: str) -> bool:
    s = str(t or "").strip()
    if not s:
        return False
    if any(ch.isdigit() for ch in s):
        return True
    return s in {"年", "月", "日", "点", "分", "秒", "%", "％", "元", "块", "号"}


def _structural_block_cut(prev_word: dict[str, Any], cur_word: dict[str, Any], quote_balance: int) -> bool:
    """结构保护：连接词、数字时间单元、引号未闭合时阻止切句。"""
    prev_t = str(prev_word.get("text") or "").strip()
    cur_t = str(cur_word.get("text") or "").strip()
    if cur_t in _CONNECTOR_TOKENS:
        return True
    if _looks_like_numeric_or_time_unit(prev_t) and _looks_like_numeric_or_time_unit(cur_t):
        return True
    if quote_balance > 0:
        return True
    return False


def _filler_attach_cut(prev_word: dict[str, Any], cur_word: dict[str, Any], pause_ms: int) -> bool:
    """短语气词吸附：优先并入主句，避免单独成句。"""
    cur_t = str(cur_word.get("text") or "").strip()
    prev_t = str(prev_word.get("text") or "").strip()
    if cur_t in _FILLER_TOKENS and pause_ms <= 420:
        return False
    if prev_t in _FILLER_TOKENS and pause_ms <= 420:
        return False
    return True


def _resegment_utt_new(words: list[dict[str, Any]], *, min_pause_ms: int, threshold: float) -> None:
    """重算 utt_new，让句边界由多信号决定而非仅 ASR 原始 utterance。"""
    if not words:
        return
    words[0]["utt_new"] = False
    line_chars = len(str(words[0].get("text") or "") + str(words[0].get("punct") or ""))
    line_start_ms = int(words[0].get("s_ms", 0))
    quote_balance = 0
    for i in range(1, len(words)):
        prev_w = words[i - 1]
        cur_w = words[i]
        prev_disp = f"{prev_w.get('text') or ''}{prev_w.get('punct') or ''}"
        quote_balance += prev_disp.count("“") + prev_disp.count("「") + prev_disp.count("『")
        quote_balance -= prev_disp.count("”") + prev_disp.count("」") + prev_disp.count("』")
        quote_balance = max(0, quote_balance)
        pause_ms = max(0, int(cur_w.get("s_ms", 0)) - int(prev_w.get("e_ms", 0)))
        cur_line_dur = max(0, int(prev_w.get("e_ms", 0)) - line_start_ms)
        score = _boundary_score(
            prev_word=prev_w,
            cur_word=cur_w,
            line_len_chars=line_chars,
            line_dur_ms=cur_line_dur,
            min_pause_ms=min_pause_ms,
        )
        if i >= 2:
            prev2_t = str(words[i - 2].get("text") or "").strip()
            prev_t = str(prev_w.get("text") or "").strip()
            cur_t = str(cur_w.get("text") or "").strip()
            # 枚举项边界：在“第一/第二/首先...”前适度放宽切句阈值
            if cur_t in _ENUM_START_TOKENS and prev_t != cur_t and prev2_t != cur_t:
                score += 0.22
        if _structural_block_cut(prev_w, cur_w, quote_balance=quote_balance):
            score -= 0.5
        if not _filler_attach_cut(prev_w, cur_w, pause_ms=pause_ms):
            score -= 0.45
        should_cut = score >= threshold
        cur_w["utt_new"] = should_cut
        if should_cut:
            line_chars = 0
            line_start_ms = int(cur_w.get("s_ms", 0))
        line_chars += len(str(cur_w.get("text") or "") + str(cur_w.get("punct") or ""))


def _quality_score(words: list[dict[str, Any]], *, min_pause_ms: int) -> float:
    """粗略质量分，用于异常回退为保守分句策略。"""
    if not words:
        return 0.0
    conf_sum = 0.0
    conf_n = 0
    boundary_hits = 0
    for i, w in enumerate(words):
        conf_sum += float(w.get("conf", 0.6))
        conf_n += 1
        if i > 0:
            pause_ms = max(0, int(w.get("s_ms", 0)) - int(words[i - 1].get("e_ms", 0)))
            if pause_ms >= min_pause_ms or bool(w.get("utt_new")):
                boundary_hits += 1
    avg_conf = conf_sum / max(1, conf_n)
    boundary_ratio = boundary_hits / max(1, len(words) - 1)
    # 过密或过稀断句都降分
    boundary_balance = 1.0 - min(1.0, abs(boundary_ratio - 0.18) * 2.8)
    return max(0.0, min(1.0, 0.7 * avg_conf + 0.3 * boundary_balance))


def _resolve_profile(
    raw: dict[str, Any],
    *,
    profile: str | None,
    speaker_hint: int | None,
) -> str:
    p = str(profile or "").strip().lower()
    if p in ("monologue", "interview", "meeting"):
        return p
    if isinstance(speaker_hint, int) and speaker_hint >= 3:
        return "meeting"
    if isinstance(speaker_hint, int) and speaker_hint >= 2:
        return "interview"
    utts = raw.get("result", {}).get("utterances") if isinstance(raw.get("result"), dict) else None
    if isinstance(utts, list):
        spks: set[int] = set()
        for ut in utts:
            if not isinstance(ut, dict):
                continue
            s = ut.get("speaker_id")
            if s is None:
                s = ut.get("speaker")
            try:
                spks.add(int(s))
            except (TypeError, ValueError):
                continue
        if len(spks) >= 3:
            return "meeting"
        if len(spks) >= 2:
            return "interview"
    return "monologue"


def _profile_default_params(profile_name: str) -> tuple[int, float, int]:
    """返回 (min_pause_ms, boundary_threshold, speaker_switch_min_ms)。"""
    if profile_name == "interview":
        return 360, 0.74, 420
    if profile_name == "meeting":
        return 320, 0.7, 480
    return 460, 0.86, 300


def normalize_volc_flash_transcript(
    raw: dict[str, Any],
    *,
    profile: str | None = None,
    speaker_hint: int | None = None,
) -> dict[str, Any]:
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
                    "conf": _word_confidence(w),
                }
            )
        if len(words_out) > n_words_before:
            utt_processed += 1

    profile_name = _resolve_profile(raw, profile=profile, speaker_hint=speaker_hint)
    def_min_pause, def_threshold, def_smooth = _profile_default_params(profile_name)
    try:
        smooth_ms = int(os.getenv("CLIP_ASR_SPEAKER_SWITCH_MIN_MS") or str(def_smooth))
    except (TypeError, ValueError):
        smooth_ms = def_smooth
    _speaker_smooth(words_out, min_switch_ms=max(80, min(1200, smooth_ms)))

    try:
        min_pause_ms = int(os.getenv("CLIP_ASR_BOUNDARY_MIN_PAUSE_MS") or str(def_min_pause))
    except (TypeError, ValueError):
        min_pause_ms = def_min_pause
    min_pause_ms = max(120, min(1800, min_pause_ms))
    try:
        threshold = float(os.getenv("CLIP_ASR_BOUNDARY_SCORE_THRESHOLD") or str(def_threshold))
    except (TypeError, ValueError):
        threshold = def_threshold
    threshold = max(0.45, min(1.6, threshold))
    _resegment_utt_new(words_out, min_pause_ms=min_pause_ms, threshold=threshold)

    q = _quality_score(words_out, min_pause_ms=min_pause_ms)
    if q < 0.52:
        # 回退：保守断句，仅在停顿明显或句末标点时断
        for i, w in enumerate(words_out):
            if i == 0:
                w["utt_new"] = False
                continue
            prev = words_out[i - 1]
            pause_ms = max(0, int(w.get("s_ms", 0)) - int(prev.get("e_ms", 0)))
            prev_p = str(prev.get("punct") or "")
            w["utt_new"] = bool(pause_ms >= max(520, min_pause_ms) or any(ch in _SENT_END_PUNCT for ch in prev_p))

    for w in words_out:
        w.pop("conf", None)

    return {"version": 1, "words": words_out, "duration_ms": duration_ms}
