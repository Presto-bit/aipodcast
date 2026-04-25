"""基于已选笔记摘录回答用户问题（轻量 RAG，非播客脚本管线）。"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import defaultdict
from typing import Any, Iterator

from .models import get_note_by_id
from .note_rag_service import NOTE_LAYERED_RAG, build_layered_notes_context
from .notes_ask_profile import notes_ask_profile_emit
from .provider_router import (
    invoke_llm_chat_messages_stream_iter,
    invoke_llm_chat_messages_with_minimax_fallback,
    script_provider,
)

logger = logging.getLogger(__name__)

_MAX_QUESTION_CHARS = 800
_MAX_TOTAL_CONTEXT = 44_000
_MAX_PER_NOTE = 16_000


def _notes_ask_top_k() -> int:
    """向量检索 top_k 上限与默认；可用环境变量 NOTES_ASK_TOP_K 覆盖（24–160）。"""
    try:
        return max(24, min(160, int(os.getenv("NOTES_ASK_TOP_K", "90") or "90")))
    except (TypeError, ValueError):
        return 90


# 常见推理模型标签（避免在流式正文中露出）
_THINK_BLOCKS = (
    re.compile(
        re.escape("<redacted_reasoning>") + r".*?" + re.escape("</redacted_reasoning>"),
        re.DOTALL | re.IGNORECASE,
    ),
    re.compile(
        re.escape("<think>") + r".*?" + re.escape("</think>"),
        re.DOTALL | re.IGNORECASE,
    ),
    # 部分厂商用 think 围栏包裹推理（避免 patch 工具吞写尖括号，用 \x3c 表示 <）
    re.compile(r"\x3cthink\x3e.*?\x3c/think\x3e", re.DOTALL | re.IGNORECASE),
)
_LEAK_PATTERNS = re.compile(
    r"(?:来源\s*\d+\s*的\s*chunk\s*=\s*\d+(?:\s+score\s*=\s*[\d.]+)?)|"
    r"(?:【检索片段[^】]{0,320}】)|"
    r"(?:chunk\s*=\s*\d+(?:\s+score\s*=\s*[\d.]+)?)",
    re.IGNORECASE,
)


def _notes_ask_sanitize_visible_text(s: str) -> str:
    """去掉推理标签、系统检索标记等不应展示给用户的片段。"""
    if not s:
        return ""
    t = s
    for pat in _THINK_BLOCKS:
        t = pat.sub("", t)
    t = _LEAK_PATTERNS.sub("", t)
    return t


_SYSTEM = (
    "你是资料助手。用户提供了若干条笔记摘录（可能已截断）。请仅用这些材料回答问题；"
    "若材料不足以回答，请明确说明「材料中未提及」或「摘录中看不到」，不要编造事实。\n"
    "回答使用中文；仅在确实依据某一来源时，在对应句子或段落后用 [1]、[2] 等形式标注来源序号（与摘录或来源清单中的序号 [n] 一致）。"
    "不要标注未在回答中实际用到的序号；也不要在正文中复述「检索片段」、chunk、score、向量、noteId 等系统或调试用语。\n"
    "不要输出思考过程、提纲或「首先/其次」式推演说明，直接给出面向用户的结论与依据。\n"
    "若问题与多条笔记均相关，请尽量在回答中分别引用不同序号，避免只依赖少数几条而忽略其他相关摘录。"
)


def _enrich_sources_with_chunks(sources: list[dict[str, Any]], retr_meta: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """将向量检索块按 noteId 归并到各来源，供前端展示摘录弹窗。"""
    if not retr_meta:
        return sources
    by_note: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in retr_meta:
        nid = str(item.get("noteId") or "").strip()
        if not nid:
            continue
        ex = str(item.get("excerpt") or "").strip()
        by_note[nid].append(
            {
                "chunkIndex": str(item.get("chunkIndex") or ""),
                "score": str(item.get("score") or ""),
                "excerpt": ex,
            }
        )
    out: list[dict[str, Any]] = []
    for s in sources:
        nid = str(s.get("noteId") or "").strip()
        merged = dict(s)
        if nid in by_note:
            merged["chunks"] = by_note[nid]
        out.append(merged)
    return out


def filter_sources_by_citations(answer: str, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    若回答中出现至少一处 [n] 角标，则脚注仅保留被引用的序号；否则保留全部来源（兼容未标角标的旧行为）。
    """
    cited = set(re.findall(r"\[(\d+)\]", answer or ""))
    if not cited:
        return sources
    return [s for s in sources if str(s.get("index") or "") in cited]


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
    project_owner_user_uuid: str | None = None,
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    q = (question or "").strip()
    if not q:
        raise ValueError("question_required")
    if len(q) > _MAX_QUESTION_CHARS:
        q = q[:_MAX_QUESTION_CHARS]

    _t_ctx = time.perf_counter()
    context, sources = build_notes_qa_context(
        notebook=notebook,
        note_ids=note_ids,
        user_ref=user_ref,
        question=q,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    notes_ask_profile_emit(
        "prepare_build_context_ms",
        (time.perf_counter() - _t_ctx) * 1000.0,
        context_chars=len(context or ""),
        sources_n=len(sources),
    )
    if not context.strip():
        raise ValueError("empty_context")

    user_block = f"资料摘录如下：\n\n{context}\n\n---\n\n问题：{q}"
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_block},
    ]
    return messages, sources


def _notes_ask_stream_error_event(exc: BaseException, *, request_id: str | None) -> dict[str, Any]:
    """SSE error 事件：便于前端与运维对照日志（勿写入密钥）。"""
    raw = str(exc).strip() or type(exc).__name__
    if raw.startswith("text_provider_") and raw.endswith("_config_missing"):
        code = raw[:200]
    elif raw in (
        "empty_answer",
        "minimax_api_key_missing",
        "openai_compatible_empty_content",
        "chat_messages_empty",
        "upstream_error",
    ):
        code = raw
    else:
        code = type(exc).__name__

    if raw == "empty_answer":
        message = (
            "模型未返回有效正文，请换一个问题或稍后重试；若使用推理类文本模型，可尝试非推理版本或 TEXT_PROVIDER=minimax。"
        )
    else:
        message = raw

    detail_parts = [f"{type(exc).__name__}: {raw}"]
    cause = exc.__cause__
    if cause is not None:
        cs = str(cause).strip()
        if cs:
            detail_parts.append(f"cause={type(cause).__name__}: {cs[:480]}")
    detail = " | ".join(detail_parts)[:1500]

    text_prov = script_provider()
    tp_env = (os.getenv("TEXT_PROVIDER") or "").strip() or "（未设置，默认 deepseek）"
    ev: dict[str, Any] = {
        "type": "error",
        "message": message,
        "code": code[:200],
        "detail": detail,
        "textProvider": text_prov,
        "hint": (
            f"编排器日志搜索：notes_ask_stream_failed；环境 TEXT_PROVIDER={tp_env}，当前路由={text_prov}。"
            "公网 504 多为 CDN/Nginx 回源超时，见仓库 deploy/nginx 与 DEPLOYMENT.md。"
        ),
    }
    rid = (request_id or "").strip()
    if rid:
        ev["requestId"] = rid
    return ev


def iter_notes_answer_events(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    api_key: str | None = None,
    prepared_messages_sources: tuple[list[dict[str, str]], list[dict[str, Any]]] | None = None,
    project_owner_user_uuid: str | None = None,
    request_id: str | None = None,
) -> Iterator[dict[str, Any]]:
    """SSE 事件：chunk / done / error。

    若调用方已通过 `_prepare_notes_ask_messages` 得到 messages/sources，可传入
    `prepared_messages_sources`，避免与校验阶段重复执行向量检索（此前流式接口会构建两遍上下文）。
    `request_id` 用于 error 事件与日志关联（通常取 X-Request-ID）。
    """
    if prepared_messages_sources is not None:
        messages, sources = prepared_messages_sources
    else:
        messages, sources = _prepare_notes_ask_messages(
            notebook=notebook,
            note_ids=note_ids,
            question=question,
            user_ref=user_ref,
            project_owner_user_uuid=project_owner_user_uuid,
        )
    acc: list[str] = []
    try:
        _t_llm = time.perf_counter()
        saw_visible = False
        for piece in invoke_llm_chat_messages_stream_iter(
            messages,
            temperature=0.45,
            api_key=api_key,
            timeout_sec=120,
        ):
            vis = _notes_ask_sanitize_visible_text(piece)
            if vis:
                if not saw_visible:
                    notes_ask_profile_emit(
                        "stream_llm_ttft_ms",
                        (time.perf_counter() - _t_llm) * 1000.0,
                    )
                    saw_visible = True
                acc.append(vis)
                yield {"type": "chunk", "text": vis}
        notes_ask_profile_emit(
            "stream_llm_total_ms",
            (time.perf_counter() - _t_llm) * 1000.0,
            visible_chars=len("".join(acc)),
        )
        full = _notes_ask_sanitize_visible_text("".join(acc)).strip()
        if not full:
            raise RuntimeError("empty_answer")
        sources = filter_sources_by_citations(full, sources)
        yield {"type": "done", "sources": sources, "traceId": None}
    except Exception as exc:
        logger.warning(
            "notes_ask_stream_failed request_id=%s: %s",
            (request_id or "").strip() or "-",
            exc,
            exc_info=True,
        )
        yield _notes_ask_stream_error_event(exc, request_id=request_id)


def legacy_build_notes_qa_context(
    *,
    notebook: str,
    note_ids: list[str],
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
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
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
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
    project_owner_user_uuid: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    优先：异步摘要 + 勾选范围内向量检索；若无索引块则回退 legacy 前缀截断。
    """
    if NOTE_LAYERED_RAG and (question or "").strip():
        layered, sources, meta = build_layered_notes_context(
            notebook=notebook,
            note_ids=note_ids,
            query=(question or "").strip(),
            user_ref=user_ref,
            summary_budget=16_000,
            retrieval_budget=40_000,
            top_k=_notes_ask_top_k(),
            project_owner_user_uuid=project_owner_user_uuid,
        )
        if layered:
            rcm = meta.get("retrieval_chunks_meta")
            if isinstance(rcm, list) and rcm:
                sources = _enrich_sources_with_chunks(sources, rcm)
            return layered, sources
    _t_leg = time.perf_counter()
    legacy_out = legacy_build_notes_qa_context(
        notebook=notebook,
        note_ids=note_ids,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    notes_ask_profile_emit(
        "prepare_legacy_context_ms",
        (time.perf_counter() - _t_leg) * 1000.0,
        note_ids_n=len(note_ids),
    )
    return legacy_out


_HINTS_SYSTEM = (
    "你是资料导读助手。用户会提供若干条笔记摘录（可能已截断）。"
    "请仅依据摘录内容，输出一个 JSON 对象（不要 markdown、不要代码围栏、不要任何 JSON 外文字）。"
    "JSON 结构必须为："
    '{"summary":"…","suggestions":["…","…","…"]} 。\n'
    "要求：summary 为中文，1～3 句、总长度不超过 220 字，概括这些材料共同涉及的主题与要点；"
    "suggestions 为恰好 3 条字符串，每条为一句用户可向助手提出的具体问题（中文），"
    "每条不超过 48 字，且应能从给定摘录中找到回答依据；不要重复或近似重复。"
)


def _parse_hints_json(raw: str) -> tuple[str, list[str]]:
    s = (raw or "").strip()
    if not s:
        raise ValueError("empty_hints")
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2 and lines[0].startswith("```"):
            s = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()
    brace = s.find("{")
    if brace >= 0:
        depth = 0
        end = -1
        for i, ch in enumerate(s[brace:], start=brace):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end > brace:
            s = s[brace:end]
    data = json.loads(s)
    if not isinstance(data, dict):
        raise ValueError("hints_shape")
    summary = str(data.get("summary") or "").strip()
    sug_raw = data.get("suggestions")
    if not isinstance(sug_raw, list):
        raise ValueError("hints_suggestions")
    suggestions = [str(x or "").strip() for x in sug_raw if str(x or "").strip()]
    if not summary or len(suggestions) < 3:
        raise ValueError("hints_incomplete")
    return summary[:400], suggestions[:3]


def generate_notes_ask_hints(
    *,
    notebook: str,
    note_ids: list[str],
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
) -> dict[str, Any]:
    """基于与问答相同的资料上下文，生成摘要 + 3 个潜在问题（单次非流式 LLM）。"""
    nb = (notebook or "").strip()
    if not nb:
        raise ValueError("notebook_required")
    q_hint = "请根据下列摘录，生成导读 JSON（summary + suggestions 共 3 条），严格按系统说明的 JSON 结构输出。"
    context, _sources = build_notes_qa_context(
        notebook=nb,
        note_ids=note_ids,
        user_ref=user_ref,
        question=q_hint,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    if not (context or "").strip():
        raise ValueError("empty_context")
    user_block = f"资料摘录如下：\n\n{context}\n\n---\n\n任务：{q_hint}"
    messages = [
        {"role": "system", "content": _HINTS_SYSTEM},
        {"role": "user", "content": user_block},
    ]
    raw, _trace = invoke_llm_chat_messages_with_minimax_fallback(
        messages,
        temperature=0.35,
        api_key=None,
        timeout_sec=90,
    )
    summary, suggestions = _parse_hints_json(raw)
    return {"summary": summary, "suggestions": suggestions}


def answer_notes_question(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    api_key: str | None = None,
    project_owner_user_uuid: str | None = None,
) -> dict[str, Any]:
    messages, sources = _prepare_notes_ask_messages(
        notebook=notebook,
        note_ids=note_ids,
        question=question,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
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

    ans = _notes_ask_sanitize_visible_text(answer.strip())
    return {
        "answer": ans,
        "sources": filter_sources_by_citations(ans, sources),
        "traceId": trace_id,
    }
