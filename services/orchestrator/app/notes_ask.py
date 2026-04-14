"""基于已选笔记摘录回答用户问题（轻量 RAG，非播客脚本管线）。"""
from __future__ import annotations

import json
import logging
from typing import Any, Iterator

from .models import get_note_by_id
from .note_rag_service import NOTE_LAYERED_RAG, build_layered_notes_context
from .provider_router import (
    invoke_llm_chat_messages_stream_iter,
    invoke_llm_chat_messages_with_minimax_fallback,
)

logger = logging.getLogger(__name__)

_MAX_QUESTION_CHARS = 800
_MAX_TOTAL_CONTEXT = 44_000
_MAX_PER_NOTE = 16_000

_SYSTEM = (
    "你是资料助手。用户提供了若干条笔记摘录（可能已截断）。请仅用这些材料回答问题；"
    "若材料不足以回答，请明确说明「材料中未提及」或「摘录中看不到」，不要编造事实。"
    "回答使用中文，可在要点处用 [1]、[2] 等形式标注对应来源序号。"
)


def _metadata_notebook(row: dict[str, Any]) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return ""
    return str(md.get("notebook") or "").strip()


def _metadata_title(row: dict[str, Any], note_id: str) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return note_id
    return str(md.get("title") or note_id).strip() or note_id


def _prepare_notes_ask_messages(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    q = (question or "").strip()
    if not q:
        raise ValueError("question_required")
    if len(q) > _MAX_QUESTION_CHARS:
        q = q[:_MAX_QUESTION_CHARS]

    context, sources = build_notes_qa_context(
        notebook=notebook, note_ids=note_ids, user_ref=user_ref, question=q
    )
    if not context.strip():
        raise ValueError("empty_context")

    user_block = f"资料摘录如下：\n\n{context}\n\n---\n\n问题：{q}"
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_block},
    ]
    return messages, sources


def validate_notes_ask_request(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
) -> None:
    """与 answer_notes_question 相同输入校验，供流式接口在建立 SSE 前返回 4xx。"""
    _prepare_notes_ask_messages(
        notebook=notebook, note_ids=note_ids, question=question, user_ref=user_ref
    )


def iter_notes_answer_events(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    api_key: str | None = None,
) -> Iterator[dict[str, Any]]:
    """SSE 事件：chunk / done / error。"""
    messages, sources = _prepare_notes_ask_messages(
        notebook=notebook, note_ids=note_ids, question=question, user_ref=user_ref
    )
    acc: list[str] = []
    try:
        for piece in invoke_llm_chat_messages_stream_iter(
            messages,
            temperature=0.45,
            api_key=api_key,
            timeout_sec=120,
        ):
            acc.append(piece)
            yield {"type": "chunk", "text": piece}
        full = "".join(acc).strip()
        if not full:
            raise RuntimeError("empty_answer")
        yield {"type": "done", "sources": sources, "traceId": None}
    except Exception as exc:
        logger.warning("notes_ask_stream_failed: %s", exc)
        yield {"type": "error", "message": str(exc)}


def legacy_build_notes_qa_context(
    *,
    notebook: str,
    note_ids: list[str],
    user_ref: str | None,
) -> tuple[str, list[dict[str, str]]]:
    """前缀截断合并（无向量索引时的回退）。"""
    nb = notebook.strip()
    if not nb:
        raise ValueError("notebook_required")
    seen: set[str] = set()
    ordered: list[str] = []
    for raw_id in note_ids:
        nid = str(raw_id or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        ordered.append(nid)
    if not ordered:
        raise ValueError("note_ids_required")

    parts: list[str] = []
    sources: list[dict[str, str]] = []
    budget = _MAX_TOTAL_CONTEXT

    for i, nid in enumerate(ordered, start=1):
        row = get_note_by_id(nid, user_ref=user_ref)
        if not row:
            raise ValueError("note_not_found")
        if _metadata_notebook(row) != nb:
            raise ValueError("note_notebook_mismatch")
        title = _metadata_title(row, nid)
        text = str(row.get("content_text") or "").strip()
        cap = min(_MAX_PER_NOTE, budget)
        if cap < 200:
            break
        chunk = text[:cap] if text else ""
        if len(text) > cap:
            chunk = chunk + "\n\n（本条摘录已截断）"
        sources.append({"index": str(i), "noteId": nid, "title": title})
        if chunk:
            parts.append(f"### 来源 [{i}] {title}\nnoteId: {nid}\n\n{chunk}")
        else:
            parts.append(f"### 来源 [{i}] {title}\nnoteId: {nid}\n\n（本条暂无正文摘录）")
        budget -= len(parts[-1])
        if budget <= 0:
            break

    return "\n\n---\n\n".join(parts), sources


def build_notes_qa_context(
    *,
    notebook: str,
    note_ids: list[str],
    user_ref: str | None,
    question: str | None = None,
) -> tuple[str, list[dict[str, str]]]:
    """
    优先：异步摘要 + 勾选范围内向量检索；若无索引块则回退 legacy 前缀截断。
    """
    if NOTE_LAYERED_RAG and (question or "").strip():
        layered, sources, _meta = build_layered_notes_context(
            notebook=notebook,
            note_ids=note_ids,
            query=(question or "").strip(),
            user_ref=user_ref,
            summary_budget=16_000,
            retrieval_budget=40_000,
            top_k=80,
        )
        if layered:
            return layered, sources
    return legacy_build_notes_qa_context(notebook=notebook, note_ids=note_ids, user_ref=user_ref)


def answer_notes_question(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    api_key: str | None = None,
) -> dict[str, Any]:
    messages, sources = _prepare_notes_ask_messages(
        notebook=notebook, note_ids=note_ids, question=question, user_ref=user_ref
    )
    try:
        answer, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
            messages,
            temperature=0.45,
            api_key=api_key,
            timeout_sec=120,
        )
    except Exception as exc:
        logger.warning("notes_ask_llm_failed: %s", exc)
        raise
    if not (answer or "").strip():
        raise RuntimeError("empty_answer")

    return {
        "answer": answer.strip(),
        "sources": sources,
        "traceId": trace_id,
    }
