"""
播客封面文生图：从脚本/用户提供文本中抽取多段素材，提升与正文主题的关联度。
"""

from __future__ import annotations

import re

_SPEAKER_HEAD_RE = re.compile(r"^\s*Speaker\s*[12]\s*[:：]\s*", re.I)


def strip_dialogue_speaker_prefixes(text: str) -> str:
    """去掉双人播客行首 Speaker1:/Speaker2:，保留台词便于主题抽取。"""
    if not (text or "").strip():
        return ""
    out: list[str] = []
    for line in str(text).splitlines():
        line = line.strip()
        if not line:
            continue
        line = _SPEAKER_HEAD_RE.sub("", line).strip()
        if line:
            out.append(line)
    return "\n".join(out).strip()


def _multi_window_body_sample(stripped_body: str, *, max_chars: int) -> str:
    """
    取正文开头 / 中段 / 结尾窗口，避免仅使用前几百字全是寒暄或开场白。
    """
    s = re.sub(r"\n{3,}", "\n\n", stripped_body.strip())
    if not s:
        return ""
    n = len(s)
    if n <= max_chars:
        return s
    head_n = min(1100, max(400, n // 4))
    tail_n = min(1100, max(400, n // 4))
    mid = n // 2
    mid_half = min(1200, n // 3)
    p1 = s[:head_n]
    p2 = s[max(0, mid - mid_half // 2) : min(n, mid + mid_half // 2)]
    p3 = s[max(0, n - tail_n) :]
    merged = f"【开头摘录】\n{p1}\n\n【中段摘录】\n{p2}\n\n【结尾摘录】\n{p3}"
    if len(merged) > max_chars:
        merged = merged[: max_chars - 1] + "…"
    return merged


def build_cover_material(
    *,
    script_body: str,
    intro: str = "",
    outro: str = "",
    program_name: str = "",
    script_constraints: str = "",
    source_text: str = "",
    max_chars: int = 3600,
) -> str:
    """
    拼出供「文本模型 → 文生图 prompt」使用的结构化素材（纯文本）。

    优先包含：节目名、用户原始素材、创作约束、正文多窗口摘录；双人稿先去 Speaker 前缀。
    """
    parts: list[str] = []
    pn = (program_name or "").strip()
    if pn:
        parts.append(f"【节目/栏目名称】{pn}")
    sc = (script_constraints or "").strip()
    if sc:
        _cap = 500
        sc_clip = sc[:_cap] + ("…" if len(sc) > _cap else "")
        parts.append(f"【对脚本/内容的创作要求】{sc_clip}")

    src = (source_text or "").strip()
    if src:
        cap = min(1600, max(400, max_chars // 2))
        src_clip = src[:cap] + ("…" if len(src) > cap else "")
        parts.append(f"【用户提供的原始素材（节选）】{src_clip}")

    intro_s = strip_dialogue_speaker_prefixes(intro)[:420] if intro else ""
    outro_s = strip_dialogue_speaker_prefixes(outro)[:420] if outro else ""
    if intro_s:
        parts.append(f"【开场/引子摘录】{intro_s}")
    if outro_s:
        parts.append(f"【结尾/收束摘录】{outro_s}")

    body = strip_dialogue_speaker_prefixes(script_body)
    budget = max_chars - sum(len(x) for x in parts) - 80
    budget = max(800, min(budget, max_chars))
    if body:
        parts.append(_multi_window_body_sample(body, max_chars=budget))

    blob = "\n\n".join(x for x in parts if x.strip()).strip()
    if len(blob) > max_chars:
        blob = blob[: max_chars - 1] + "…"
    return blob
