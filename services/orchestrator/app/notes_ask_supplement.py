"""资料问答阶段 2：资料未覆盖时用通识补充（方案 B，无前端开关，自动触发）。"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Iterator

from .notes_ask_style import notes_ask_temperature
from .provider_router import invoke_llm_chat_messages_stream_iter

logger = logging.getLogger(__name__)

_THINK_BLOCKS = (
    re.compile(
        re.escape("<redacted_reasoning>") + r".*?" + re.escape("</redacted_reasoning>"),
        re.DOTALL | re.IGNORECASE,
    ),
    re.compile(
        re.escape("<think>") + r".*?" + re.escape("</think>"),
        re.DOTALL | re.IGNORECASE,
    ),
    re.compile(r"\x3cthink\x3e.*?\x3c/think\x3e", re.DOTALL | re.IGNORECASE),
)
_LEAK_PATTERNS = re.compile(
    r"(?:来源\s*\d+\s*的\s*chunk\s*=\s*\d+(?:\s+score\s*=\s*[\d.]+)?)|"
    r"(?:【检索片段[^】]{0,320}】)|"
    r"(?:chunk\s*=\s*\d+(?:\s+score\s*=\s*[\d.]+)?)",
    re.IGNORECASE,
)


def _sanitize_visible_text(s: str) -> str:
    if not s:
        return ""
    t = s
    for pat in _THINK_BLOCKS:
        t = pat.sub("", t)
    return _LEAK_PATTERNS.sub("", t)

_MATERIAL_GAP_RE = re.compile(
    r"材料中未提及|摘录中看不到|无法从已索引|没有.{0,8}(?:记载|提及)|"
    r"未在.{0,10}资料|不足以|未覆盖|未找到.{0,8}相关",
    re.I,
)
_NO_SUPPLEMENT_MARK = "[[NO_SUPPLEMENT]]"
_SKIP_SUPPLEMENT_RE = re.compile(
    r"资料已足够|无需补充|不必补充|不需要补充|无须补充|已足够回答",
    re.I,
)
_SUPPLEMENT_HEADING_RE = re.compile(
    r"^#+\s*补充说明[^\n]*\n+",
    re.MULTILINE,
)
_CITATION_IN_SUPPLEMENT_RE = re.compile(r"\[\s*\d+\s*\]")


def notes_ask_supplement_enabled() -> bool:
    return (os.getenv("NOTES_ASK_SUPPLEMENT", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def notes_ask_supplement_max_tokens() -> int:
    try:
        return max(256, min(2048, int(os.getenv("NOTES_ASK_SUPPLEMENT_MAX_TOKENS", "1024") or "1024")))
    except (TypeError, ValueError):
        return 1024


def _max_retrieval_score(retr_meta: list[dict[str, Any]] | None) -> float | None:
    if not retr_meta:
        return None
    scores: list[float] = []
    for row in retr_meta:
        try:
            scores.append(float(row.get("score") or 0))
        except (TypeError, ValueError):
            continue
    return max(scores) if scores else None


def answer_signals_material_gap(answer: str) -> bool:
    return bool(_MATERIAL_GAP_RE.search((answer or "").strip()))


def should_run_supplement_stage(
    *,
    corpus_answer: str,
    qa_plan: dict[str, Any],
    shared_read_only: bool = False,
) -> bool:
    """是否在资料作答后追加通识补充阶段。"""
    if shared_read_only or not notes_ask_supplement_enabled():
        return False
    if bool(qa_plan.get("lowConfidence")):
        return True
    cov = str(qa_plan.get("plannerCoverage") or qa_plan.get("coverage") or "").strip().lower()
    if cov in ("none", "partial"):
        return True
    if str(qa_plan.get("plannerNeedsSupplement") or "").strip().lower() in ("1", "true", "yes"):
        return True
    if answer_signals_material_gap(corpus_answer):
        return True
    retr = qa_plan.get("retrievalChunksMeta")
    if isinstance(retr, list):
        mx = _max_retrieval_score(retr)
        if mx is not None and mx < 0.08 and len((corpus_answer or "").strip()) < 400:
            return True
    return False


def _format_source_titles(sources: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for s in sources[:16]:
        idx = str(s.get("index") or "").strip()
        title = str(s.get("title") or s.get("noteId") or "").strip()
        if idx or title:
            lines.append(f"[{idx}] {title}" if idx else title)
    return "；".join(lines) if lines else "（无）"


def build_supplement_messages(
    *,
    question: str,
    corpus_answer: str,
    sources: list[dict[str, Any]],
    supplement_focus: str = "",
) -> list[dict[str, str]]:
    focus = (supplement_focus or "").strip() or "针对资料未覆盖的部分作通识解释，勿重复资料段。"
    system = (
        "你是补充说明助手。用户已有一份「仅依据所选资料」的回答；"
        "你的任务是在资料未覆盖处用通识帮助理解，不要伪造资料引用。\n"
        "硬性规则：\n"
        "1. 以二级标题开头：## 补充说明（非资料原文，仅供参考）\n"
        "2. 禁止使用 [1][2] 等角标；不要写「该书指出」式归因；\n"
        "3. 不要重复资料段已有内容；简洁有条理；\n"
        "4. 若资料段已完整回答问题，只输出精确标记 [[NO_SUPPLEMENT]]，不要输出任何其它文字。\n"
        "5. 使用中文 Markdown。"
    )
    user = (
        f"用户问题：{(question or '').strip()[:800]}\n\n"
        f"资料回答（摘要，勿照抄）：\n{(corpus_answer or '').strip()[:2400]}\n\n"
        f"已选资料标题：{_format_source_titles(sources)}\n\n"
        f"补充重点：{focus[:400]}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def is_discard_supplement_text(raw: str) -> bool:
    """是否属于「无需向用户展示补充段」的模型输出（含旧版自然语言拒答）。"""
    t = _sanitize_visible_text(raw or "").strip()
    if not t:
        return True
    if _NO_SUPPLEMENT_MARK.replace(" ", "") in t.replace(" ", ""):
        return True
    body = _SUPPLEMENT_HEADING_RE.sub("", t).strip()
    if not body:
        return True
    if _SKIP_SUPPLEMENT_RE.search(body) and len(body) < 220:
        return True
    # 仅有标题 + 一句拒答
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) <= 2 and _SKIP_SUPPLEMENT_RE.search(body):
        return True
    return False


def sanitize_supplement_answer(raw: str) -> str:
    if is_discard_supplement_text(raw):
        return ""
    t = _sanitize_visible_text(raw or "").strip()
    t = t.replace(_NO_SUPPLEMENT_MARK, "").strip()
    t = _CITATION_IN_SUPPLEMENT_RE.sub("", t)
    if not t:
        return ""
    if not t.lstrip().startswith("##"):
        t = "## 补充说明（非资料原文，仅供参考）\n\n" + t
    return t.strip()


def iter_supplement_answer_chunks(
    *,
    question: str,
    corpus_answer: str,
    sources: list[dict[str, Any]],
    supplement_focus: str = "",
    api_key: str | None = None,
) -> Iterator[str]:
    """流式生成；若判定为无需补充则全程不 yield。"""
    messages = build_supplement_messages(
        question=question,
        corpus_answer=corpus_answer,
        sources=sources,
        supplement_focus=supplement_focus,
    )
    temp = max(0.2, min(0.5, notes_ask_temperature() - 0.15))
    acc: list[str] = []
    for piece in invoke_llm_chat_messages_stream_iter(
        messages,
        temperature=temp,
        api_key=api_key,
        timeout_sec=90,
        max_tokens=notes_ask_supplement_max_tokens(),
    ):
        vis = _sanitize_visible_text(piece)
        if not vis:
            continue
        acc.append(vis)
        if is_discard_supplement_text("".join(acc)):
            return
    final = sanitize_supplement_answer("".join(acc))
    if not final:
        return
    # 仅向 SSE 推送已消毒后的正文，避免「无需补充」类文案闪现
    yield final


def generate_supplement_answer(
    *,
    question: str,
    corpus_answer: str,
    sources: list[dict[str, Any]],
    supplement_focus: str = "",
    api_key: str | None = None,
) -> str:
    acc: list[str] = []
    try:
        for piece in iter_supplement_answer_chunks(
            question=question,
            corpus_answer=corpus_answer,
            sources=sources,
            supplement_focus=supplement_focus,
            api_key=api_key,
        ):
            acc.append(piece)
    except Exception as exc:
        logger.warning("notes_ask_supplement_failed: %s", exc)
        return ""
    return sanitize_supplement_answer("".join(acc))
