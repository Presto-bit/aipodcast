"""默认启用：用 TEXT_PROVIDER 为「我的作品」精炼列表标题（WORK_RESULT_TITLE_LLM=0 可关闭）。"""

from __future__ import annotations

import logging
import re
from typing import Any

from .provider_router import invoke_llm_chat_messages_with_minimax_fallback
from .share_publish_llm import build_share_user_source_text, condense_script_for_share_llm

logger = logging.getLogger(__name__)

_TITLE_LINE_MAX = 72
_GENERIC_FALLBACKS = frozenset(
    {
        "本期播客",
        "AI 播客节目",
        "MiniMax AI 播客节目",
        "播客成片",
        "语音合成",
        "文稿",
        "未命名作品",
    }
)


def _sanitize_one_line_title(raw: str) -> str:
    t = (raw or "").strip().replace("\r\n", "\n")
    for prefix in ('"', "'", "「", "『", "《", "【"):
        if t.startswith(prefix):
            t = t[len(prefix) :].lstrip()
    if t.lower().startswith("标题：") or t.startswith("标题:"):
        t = t[3:].lstrip()
    for suffix in ('"', "'", "」", "』", "》", "】"):
        if t.endswith(suffix):
            t = t[: -len(suffix)].rstrip()
    line = (t.splitlines()[0] if t else "").strip()
    line = re.sub(r"\s+", " ", line)
    if len(line) > _TITLE_LINE_MAX:
        line = line[: _TITLE_LINE_MAX - 1] + "…"
    return line


def try_refine_listing_title_with_llm(
    payload: dict[str, Any],
    script_body: str,
    *,
    current_title: str = "",
    job_type: str = "",
    result: dict[str, Any] | None = None,
    api_key: str | None = None,
) -> str | None:
    """
    在规则标题 assign 之后调用；用户已填 episode_title / podcast_title 时不覆盖。
    需 TEXT_PROVIDER / MiniMax 可用；全局可由 WORK_RESULT_TITLE_LLM=0 关闭。
    """
    pl = payload if isinstance(payload, dict) else {}
    if str(pl.get("episode_title") or pl.get("podcast_title") or "").strip():
        return None
    condensed = condense_script_for_share_llm(str(script_body or ""), max_chars=8000)
    if len(condensed.strip()) < 80:
        return None
    material = build_share_user_source_text(pl, result if isinstance(result, dict) else None)
    user_parts: list[str] = []
    if material.strip():
        user_parts.append("【选题与用户素材】\n" + material[:5200])
    user_parts.append("【口播摘要稿】\n" + condensed)
    hint_cur = (current_title or "").strip()
    if hint_cur:
        user_parts.append("【当前规则生成的标题（可替换为更佳）】\n" + hint_cur[:200])
    user = "\n\n".join(user_parts)

    jt = (job_type or "").strip().lower()
    if jt in ("podcast_generate", "podcast", "podcast_short_video"):
        kind = "播客单集"
    elif jt in ("text_to_speech", "tts"):
        kind = "语音作品"
    elif jt == "script_draft":
        kind = "文稿作品"
    else:
        kind = "作品"

    system = f"""你是中文播客与知识类内容编辑。请根据素材与口播摘要，生成一条用于「我的作品」列表展示的作品标题（{kind}）。
规则：
1. 只输出一行纯文本标题本身：不要有引号、书名号包裹全句、不要编号、不要「标题：」前缀。
2. 长度约 6～28 个汉字为宜，最长不超过 34 字；须具体、可与其他单集区分。
3. 优先体现选题、核心观点或笔记主题；避免「大家好」「欢迎收听」等开场套话。
4. 若素材与口播侧重点不同，以素材与整体语义综合为准。
5. 不要包含 Speaker1、说话人1 等多轮对白标记。"""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user[:14_000]}]
    try:
        raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(
            messages, temperature=0.32, api_key=api_key, timeout_sec=48
        )
    except Exception as exc:
        logger.warning("listing title llm call failed: %s", exc)
        return None
    cand = _sanitize_one_line_title(str(raw or ""))
    if len(cand) < 4:
        return None
    if cand in _GENERIC_FALLBACKS:
        return None
    if cand == hint_cur:
        return None
    low_start = cand[:12].lower()
    if low_start.startswith("speaker") or "说话人" in cand[:8]:
        return None
    return cand
