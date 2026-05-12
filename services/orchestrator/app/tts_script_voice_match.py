"""
文稿与默认播客音色（Mini 女 / Max 男）的轻量对齐。

设计要点（便于后续扩展时对照）：
- **仅替换默认两条**：当前 voice_id / voice_id_1 / voice_id_2 必须严格等于
  `default_minimax_podcast_voice_ids()` 返回的 mini / max，才做性别启发式交换；
  用户自选克隆或系统音色 ID 一律不动，避免误配。
- **启发式非 LLM**：对中文「他/她」与少量称谓词计数，阈值保守，宁可不调也不乱调。
- **执行时机**：须在 `run_extended_tts` 内、正文润色与 `normalize_dialogue_speaker_lines` 完成之后，
  再对最终 `main_body` 取样，避免润色改写人称后仍用旧音色。
- **双人**：按 Speaker1 / Speaker2 行拆分后分别推断；若调整后两人音色撞车，则把第二位改回与第一位相反的默认 ID。
- **开场/片头音色**：仍尊重 payload 的 `intro_voice_id` / `outro_voice_id` 显式覆盖；未覆盖时跟随已调整的主说话人音色。
- **关闭**：环境变量 `TTS_AUTO_VOICE_GENDER=0` / `false` / `no` 时整段逻辑短路。
- **局限**：外语稿、极短正文、刻意中性写法、或「他/她」与真实叙述性别不一致时，可能仍不匹配——产品侧可引导用户手动选音色。
"""

from __future__ import annotations

import os
import re
from typing import Literal

GenderHint = Literal["female", "male"] | None

# 多字词略增权；单字「她」「他」已在主计数里
_EXTRA_FEMALE = (
    "女友",
    "妻子",
    "太太",
    "老婆",
    "姑娘",
    "女生",
    "女士",
    "姐妹",
    "闺蜜",
    "母亲",
    "妈妈",
    "奶奶",
    "外婆",
    "姥姥",
)
_EXTRA_MALE = (
    "男友",
    "丈夫",
    "先生",
    "老公",
    "兄弟",
    "哥们",
    "小伙子",
    "帅哥",
    "男士",
    "男生",
    "父亲",
    "爸爸",
    "爷爷",
    "外公",
    "姥爷",
)


def _tts_auto_voice_gender_enabled() -> bool:
    raw = (os.getenv("TTS_AUTO_VOICE_GENDER", "1") or "").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _sample(text: str, max_chars: int = 12000) -> str:
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[:max_chars]


def infer_mono_gender_hint(text: str) -> GenderHint:
    """对单段中文文本做保守的叙述性别倾向推断；不足以判断时返回 None。"""
    if not _tts_auto_voice_gender_enabled():
        return None
    s = _sample(text)
    if len(s) < 120:
        return None
    n_female = s.count("她")
    n_male = len(re.findall(r"他(?![们])", s))
    extra_f = sum(s.count(w) for w in _EXTRA_FEMALE)
    extra_m = sum(s.count(w) for w in _EXTRA_MALE)
    score_f = n_female + extra_f * 2
    score_m = n_male + extra_m * 2
    gap = 10
    floor = 14
    if score_f >= score_m + gap and score_f >= floor:
        return "female"
    if score_m >= score_f + gap and score_m >= floor:
        return "male"
    return None


def _split_dialogue_speakers(script: str) -> tuple[str, str]:
    s1: list[str] = []
    s2: list[str] = []
    for raw in (script or "").splitlines():
        line = raw.strip()
        if line.startswith("Speaker1:"):
            s1.append(line[9:].strip())
        elif line.startswith("Speaker2:"):
            s2.append(line[9:].strip())
    return "\n".join(s1), "\n".join(s2)


def adjust_minimax_default_voices_for_script(
    *,
    main_body: str,
    tts_mode: str,
    voice_id: str,
    voice_id_1: str,
    voice_id_2: str,
    def_mini: str,
    def_max: str,
) -> tuple[str, str, str, str | None]:
    """
    按文稿启发式微调默认男女音色。返回 (voice_id, voice_id_1, voice_id_2, log_tag)。
    log_tag 为 None 表示未调整；否则为简短原因说明（写入 TTS 元数据/任务日志）。
    """
    mode = (tts_mode or "single").strip().lower()
    v0 = (voice_id or "").strip()
    v1 = (voice_id_1 or "").strip()
    v2 = (voice_id_2 or "").strip()
    mini = (def_mini or "").strip()
    maxv = (def_max or "").strip()
    if not mini or not maxv:
        return v0, v1, v2, None

    def _align_default(cur: str, hint: GenderHint) -> tuple[str, bool]:
        """hint 为 female → 应用女声 mini；hint 为 male → 应用男声 max。仅当当前为相反默认 ID 时替换。"""
        if hint == "female" and cur == maxv:
            return mini, True
        if hint == "male" and cur == mini:
            return maxv, True
        return cur, False

    tag: str | None = None
    if mode == "dual":
        body = (main_body or "").strip()
        p1, p2 = _split_dialogue_speakers(body)
        h1 = infer_mono_gender_hint(p1) if len(p1) >= 80 else infer_mono_gender_hint(body)
        h2 = infer_mono_gender_hint(p2) if len(p2) >= 80 else infer_mono_gender_hint(body)
        nv1, c1 = _align_default(v1, h1)
        nv2, c2 = _align_default(v2, h2)
        if nv1 == nv2 and (c1 or c2):
            nv2 = maxv if nv1 == mini else mini
        if c1 or c2:
            parts = [x for x, ok in (("Speaker1", c1), ("Speaker2", c2)) if ok]
            tag = "dual_default_voice_gender:" + "+".join(parts) if parts else None
        return v0, nv1, nv2, tag

    hint = infer_mono_gender_hint(main_body or "")
    nv, changed = _align_default(v0, hint)
    if changed:
        tag = "single_default_voice_gender"
    return nv, v1, v2, tag
