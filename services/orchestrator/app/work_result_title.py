"""任务成功落库前：为 result 写入人类可读 title（作品列表、分享默认值等）。"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)


def _listing_title_llm_enabled() -> bool:
    """默认开启；仅当环境变量显式为 0/false/no/off 时关闭。"""
    v = os.environ.get("WORK_RESULT_TITLE_LLM")
    if v is None:
        return True
    return str(v).strip().lower() not in ("0", "false", "no", "off")

from .note_work_meta import snapshot_notes_source_titles

_TITLE_MAX = 300

KNOWN_DEFAULT_PROGRAM_NAMES = frozenset({"本期播客", "AI 播客节目", "MiniMax AI 播客节目"})

_SPEAKER_LINE_PREFIX_RE = re.compile(
    r"^\s*(?:Speaker\s*[12]|说话人\s*[12]|S\s*[12])\s*[:：]\s*",
    re.IGNORECASE,
)


def _collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _cap(s: str) -> str:
    t = _collapse_ws(s)
    if len(t) <= _TITLE_MAX:
        return t
    return t[: _TITLE_MAX - 1] + "…"


def derive_work_result_title(
    payload: dict[str, Any],
    script_body: str,
    *,
    job_type: str = "",
) -> str:
    """
    优先级：显式单集标题 → 非占位节目名 → core_question → 首条引用笔记标题
    → 口播首条实质行 → 正文前若干字 → job_type 兜底。
    """
    pl = payload if isinstance(payload, dict) else {}
    for key in ("episode_title", "podcast_title"):
        raw = str(pl.get(key) or "").strip()
        if len(raw) >= 2:
            return _cap(raw)
    pn = str(pl.get("program_name") or "").strip()
    if pn and pn not in KNOWN_DEFAULT_PROGRAM_NAMES and len(pn) >= 2:
        return _cap(pn)
    cq = str(pl.get("core_question") or "").strip()
    if len(cq) >= 8:
        return _cap(cq)
    for lab in snapshot_notes_source_titles(pl):
        if lab and lab != "未命名笔记":
            return _cap(lab)

    script = str(script_body or "").replace("\r\n", "\n").strip()
    for line in script.split("\n"):
        stripped = _SPEAKER_LINE_PREFIX_RE.sub("", line).strip()
        if len(stripped) >= 6:
            return _cap(stripped)

    flat_parts: list[str] = []
    for line in script.split("\n"):
        s = _SPEAKER_LINE_PREFIX_RE.sub("", line).strip()
        if s:
            flat_parts.append(s)
    flat = _collapse_ws(" ".join(flat_parts))
    if flat:
        if len(flat) > 88:
            return _cap(flat[:87] + "…")
        return _cap(flat)

    jt = (job_type or "").strip().lower()
    if jt in ("text_to_speech", "tts"):
        return "语音合成"
    if jt in ("podcast_generate", "podcast"):
        return "播客成片"
    if jt == "script_draft":
        return "文稿"
    return "未命名作品"


def assign_work_result_title(
    result: dict[str, Any],
    payload: dict[str, Any],
    script_body: str,
    *,
    job_type: str = "",
) -> None:
    """就地写入 result['title']（成功终态前调用）。"""
    t = derive_work_result_title(payload, script_body, job_type=job_type)
    if t:
        result["title"] = t


def assign_work_result_title_with_optional_llm(
    result: dict[str, Any],
    payload: dict[str, Any],
    script_body: str,
    *,
    job_type: str = "",
    api_key: str | None = None,
) -> None:
    """
    先写入规则标题；默认再尝试用 TEXT_PROVIDER 精炼列表标题（WORK_RESULT_TITLE_LLM=0/false/off 可关闭）。
    用户已在 payload 填写 episode_title / podcast_title 时不调用 LLM，避免覆盖显式命名。
    """
    assign_work_result_title(result, payload, script_body, job_type=job_type)
    if not _listing_title_llm_enabled():
        return
    try:
        from .work_result_title_llm import try_refine_listing_title_with_llm

        cur = str(result.get("title") or "").strip()
        refined = try_refine_listing_title_with_llm(
            payload if isinstance(payload, dict) else {},
            str(script_body or ""),
            current_title=cur,
            job_type=job_type,
            result=result if isinstance(result, dict) else None,
            api_key=api_key,
        )
        if refined:
            result["title"] = refined
    except Exception as exc:
        logger.warning("WORK_RESULT_TITLE_LLM refine skipped: %s", exc)
