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
from .note_rag_service import NOTE_LAYERED_RAG, build_layered_notes_context, build_notes_source_manifest
from .notes_ask_qa import build_notes_qa_context_with_plan, resolve_notes_ask_plan
from .notes_ask_citations import collapse_citation_markers
from .notes_ask_style import (
    build_notes_ask_system_prompt,
    build_notes_ask_user_preamble,
    build_planner_messages,
    followup_min_answer_chars,
    followups_enabled,
    format_planner_block,
    merge_adjacent_chunks_enabled,
    notes_ask_max_output_tokens,
    notes_ask_temperature,
    parse_followup_json,
    parse_planner_json,
    resolve_retrieval_top_k,
    two_phase_planner_enabled,
)
from .rag_core import _keyword_score, split_text_into_chunks
from .notes_ask_profile import notes_ask_profile_emit
from .provider_router import (
    invoke_llm_chat_messages_stream_iter,
    invoke_llm_chat_messages_stream_segments_iter,
    invoke_llm_chat_messages_with_minimax_fallback,
    script_provider,
)

logger = logging.getLogger(__name__)

_MAX_QUESTION_CHARS = 800
_MAX_TOTAL_CONTEXT = 44_000
_MAX_PER_NOTE = 16_000
_ASK_HISTORY_MAX_TURNS = 8
_ASK_CONTEXT_CACHE_TTL_SEC = 30.0
_ASK_CONTEXT_CACHE: dict[str, tuple[float, str, list[dict[str, Any]]]] = {}


def _notes_ask_reasoning_stream_cap_chars() -> int:
    """单轮 SSE 推理片段累计上限（防极端长推理占满带宽）；默认 120000，可用 NOTES_ASK_REASONING_MAX_CHARS 覆盖。"""
    try:
        return max(4_000, min(200_000, int(os.getenv("NOTES_ASK_REASONING_MAX_CHARS", "120000") or "120000")))
    except (TypeError, ValueError):
        return 120_000


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
        chunk_row: dict[str, Any] = {
            "chunkIndex": str(item.get("chunkIndex") or ""),
            "score": str(item.get("score") or ""),
            "excerpt": ex,
        }
        try:
            cs = int(item.get("charStart"))
            ce = int(item.get("charEnd"))
            if ce > cs >= 0:
                chunk_row["charStart"] = cs
                chunk_row["charEnd"] = ce
        except (TypeError, ValueError):
            pass
        try:
            chunk_row["page"] = int(item.get("page"))
        except (TypeError, ValueError):
            if item.get("page") is not None:
                chunk_row["page"] = item.get("page")
        hp = item.get("headingPath")
        if isinstance(hp, list) and hp:
            chunk_row["headingPath"] = hp
        by_note[nid].append(chunk_row)
    out: list[dict[str, Any]] = []
    for s in sources:
        nid = str(s.get("noteId") or "").strip()
        merged = dict(s)
        if nid in by_note:
            merged["chunks"] = by_note[nid]
        out.append(merged)
    return out


def _notes_ask_citation_collapse_enabled() -> bool:
    return (os.getenv("NOTES_ASK_CITATION_COLLAPSE", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def finalize_notes_ask_answer(answer: str) -> str:
    """清洗可见文本并按论点块合并冗余角标。"""
    t = _notes_ask_sanitize_visible_text(answer or "").strip()
    if not t:
        return ""
    if _notes_ask_citation_collapse_enabled():
        t = collapse_citation_markers(t)
    return t


def filter_sources_by_citations(
    answer: str,
    sources: list[dict[str, Any]],
    *,
    include_all_sources: bool | None = None,
) -> list[dict[str, Any]]:
    """
    若回答中出现至少一处 [n] 角标，则脚注仅保留被引用的序号；否则保留全部来源（兼容未标角标的旧行为）。
    """
    if include_all_sources is None:
        keep_all = (os.getenv("NOTES_ASK_KEEP_ALL_SELECTED_SOURCES", "0") or "").strip().lower() not in (
            "0",
            "false",
            "no",
        )
    else:
        keep_all = bool(include_all_sources)
    if keep_all:
        return sources
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


def _metadata_preprocess_status(row: dict[str, Any]) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return ""
    return str(md.get("preprocessStatus") or "").strip().lower()


def _notes_ask_require_preprocess_ready_default() -> bool:
    return (os.getenv("NOTES_ASK_REQUIRE_PREPROCESS_READY_DEFAULT", "0") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _assert_parse_gate_for_notes(
    *,
    note_ids: list[str],
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
) -> None:
    ordered = _ordered_note_ids(note_ids)
    blocked: list[str] = []
    for nid in ordered:
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if not row:
            continue
        md = row.get("metadata") or {}
        if isinstance(md, str):
            try:
                md = json.loads(md) if md.strip() else {}
            except Exception:
                md = {}
        if str((md if isinstance(md, dict) else {}).get("parseGate") or "") == "blocked":
            blocked.append(_metadata_title(row, nid))
    if blocked:
        raise ValueError("parse_gate_blocked")


def _assert_preprocess_ready_for_notes(
    *,
    notebook: str,
    note_ids: list[str],
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
) -> None:
    ordered = _ordered_note_ids(note_ids)
    if not ordered:
        raise ValueError("note_ids_required")
    not_ready_titles: list[str] = []
    for nid in ordered:
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if not row:
            raise ValueError("note_not_found")
        if _metadata_notebook(row) != (notebook or "").strip():
            raise ValueError("note_notebook_mismatch")
        st = _metadata_preprocess_status(row)
        if st != "ready":
            not_ready_titles.append(_metadata_title(row, nid))
    if not_ready_titles:
        raise ValueError("preprocess_not_ready")


def _ordered_note_ids(note_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw_id in note_ids:
        nid = str(raw_id or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        ordered.append(nid)
    return ordered


def _question_snippet_windows(text: str, question: str, cap: int) -> str:
    """
    legacy 回退时的轻量问题感知选段：按关键词分对切块粗排，优先返回与问题更相关的窗口。
    """
    body = (text or "").strip()
    q = (question or "").strip()
    if not body:
        return ""
    if not q:
        return body[:cap]
    chunks = split_text_into_chunks(body)
    if not chunks:
        return body[:cap]
    scored = [(float(_keyword_score(q, ch)), ch) for ch in chunks if (ch or "").strip()]
    scored.sort(key=lambda x: -x[0])
    picked: list[str] = []
    used = 0
    for score, chunk in scored:
        if used >= cap:
            break
        ch = chunk.strip()
        if not ch:
            continue
        # 关键词全失配时，兜底保留开头窗口避免空上下文。
        if score <= 0 and picked:
            continue
        remain = cap - used
        part = ch if len(ch) <= remain else ch[:remain]
        picked.append(part)
        used += len(part) + 2
    if not picked:
        return body[:cap]
    out = "\n\n".join(picked).strip()
    if len(body) > len(out):
        return out + "\n\n（本条摘录已按问题相关性抽样，非全文）"
    return out


def _notes_ask_context_cache_key(
    *,
    notebook: str,
    ordered_note_ids: list[str],
    user_ref: str | None,
    project_owner_user_uuid: str | None,
    question: str,
) -> str:
    return "|".join(
        [
            (notebook or "").strip(),
            ",".join(ordered_note_ids),
            (user_ref or "").strip(),
            (project_owner_user_uuid or "").strip(),
            (question or "").strip()[:300],
        ]
    )


def _notes_ask_context_cache_get(key: str) -> tuple[str, list[dict[str, Any]]] | None:
    now = time.time()
    item = _ASK_CONTEXT_CACHE.get(key)
    if not item:
        return None
    ts, context, sources = item
    if now - ts > _ASK_CONTEXT_CACHE_TTL_SEC:
        _ASK_CONTEXT_CACHE.pop(key, None)
        return None
    return context, [dict(x) for x in sources]


def _notes_ask_context_cache_set(key: str, context: str, sources: list[dict[str, Any]]) -> None:
    _ASK_CONTEXT_CACHE[key] = (time.time(), context, [dict(x) for x in sources])
    if len(_ASK_CONTEXT_CACHE) > 64:
        old_keys = sorted(_ASK_CONTEXT_CACHE.keys(), key=lambda k: _ASK_CONTEXT_CACHE[k][0])[:16]
        for k in old_keys:
            _ASK_CONTEXT_CACHE.pop(k, None)


def _run_notes_ask_planner(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any] | None:
    """层 B：可选 Planner（仅来源清单，无正文检索）。"""
    if not two_phase_planner_enabled():
        return None
    try:
        manifest, _sources = build_notes_source_manifest(
            notebook=notebook,
            note_ids=note_ids,
            user_ref=user_ref,
            project_owner_user_uuid=project_owner_user_uuid,
        )
        plan_messages = build_planner_messages(manifest_block=manifest, question=question)
        raw, _tid = invoke_llm_chat_messages_with_minimax_fallback(
            plan_messages,
            temperature=0.25,
            api_key=api_key,
            timeout_sec=45,
            max_tokens=640,
        )
        return parse_planner_json(raw)
    except Exception as exc:
        logger.warning("notes_ask_planner_failed: %s", exc)
        return None


def _build_history_block(chat_history: list[dict[str, str]] | None) -> str:
    rows = chat_history or []
    if not rows:
        return ""
    normed: list[str] = []
    for row in rows[-_ASK_HISTORY_MAX_TURNS:]:
        role = str(row.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        who = "用户" if role == "user" else "助手"
        normed.append(f"{who}：{content[:1200]}")
    if not normed:
        return ""
    return "对话历史（仅作上下文衔接，事实依据仍以本轮资料摘录为准）：\n\n" + "\n\n".join(normed)


def _prepare_notes_ask_messages(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    chat_history: list[dict[str, str]] | None = None,
    require_preprocess_ready: bool | None = None,
    project_owner_user_uuid: str | None = None,
) -> tuple[list[dict[str, str]], list[dict[str, Any]], dict[str, Any]]:
    q = (question or "").strip()
    if not q:
        raise ValueError("question_required")
    if len(q) > _MAX_QUESTION_CHARS:
        q = q[:_MAX_QUESTION_CHARS]
    need_preprocess = _notes_ask_require_preprocess_ready_default() if require_preprocess_ready is None else bool(
        require_preprocess_ready
    )
    if need_preprocess:
        _assert_preprocess_ready_for_notes(
            notebook=notebook,
            note_ids=note_ids,
            user_ref=user_ref,
            project_owner_user_uuid=project_owner_user_uuid,
        )
    _assert_parse_gate_for_notes(
        note_ids=note_ids,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
    )

    plan = _run_notes_ask_planner(
        notebook=notebook,
        note_ids=note_ids,
        question=q,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    plan_type = str((plan or {}).get("answerType") or "").strip() or None
    top_k, answer_type = resolve_retrieval_top_k(q, plan_type)

    qa_plan = resolve_notes_ask_plan(
        notebook=notebook,
        note_ids=note_ids,
        question=q,
        user_ref=user_ref,
        chat_history=chat_history,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    _t_ctx = time.perf_counter()
    context, sources, qa_meta = build_notes_qa_context_with_plan(
        notebook=notebook,
        note_ids=note_ids,
        question=q,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
        top_k=top_k,
        chat_history=chat_history,
        plan=qa_plan,
    )
    notes_ask_profile_emit(
        "prepare_build_context_ms",
        (time.perf_counter() - _t_ctx) * 1000.0,
        context_chars=len(context or ""),
        sources_n=len(sources),
        top_k=top_k,
        answer_type=answer_type,
        qa_mode=str(qa_meta.get("qaMode") or ""),
    )
    if not context.strip():
        raise ValueError("empty_context")

    history_block = _build_history_block(chat_history)
    preamble = build_notes_ask_user_preamble()
    hint = str(qa_plan.get("coverageHint") or "").strip()
    if hint:
        preamble += f"\n\n【覆盖率与本轮模式】{hint}（qaMode={qa_plan.get('qaMode')}）"
    if qa_meta.get("lowConfidence") or qa_plan.get("lowConfidence"):
        preamble += (
            "\n\n【置信度】检索分数偏低或向量覆盖率不足：若材料未明确记载，"
            "须直接说明「无法从已索引内容确认」，勿编造。"
        )
    body_parts: list[str] = [preamble + context]
    if history_block:
        body_parts.append(history_block)
    if plan:
        body_parts.append(format_planner_block(plan))
    body_parts.append(f"问题：{q}")
    user_block = "\n\n---\n\n".join(body_parts)
    messages = [
        {"role": "system", "content": build_notes_ask_system_prompt(answer_type)},
        {"role": "user", "content": user_block},
    ]
    qa_plan = {**qa_plan, **qa_meta}
    return messages, sources, qa_plan


_NOTES_ASK_VALUE_ERROR_MESSAGES: dict[str, str] = {
    "empty_context": "当前勾选资料没有可用于问答的正文（可能尚在解析/索引中）。请打开资料预览确认已有文字，或稍后再试。",
    "note_not_found": "部分资料已不存在或无权访问，请刷新列表后重新勾选。",
    "notebook_required": "请先选择笔记本。",
    "note_ids_required": "请至少勾选一条资料后再提问。",
    "question_required": "请输入问题。",
    "too_many_notes": "勾选的资料条数超过上限，请减少勾选后再试。",
    "note_notebook_mismatch": "勾选资料与当前笔记本不一致，请刷新后重选。",
    "preprocess_not_ready": "已开启严格准入：请等待所选资料完成预处理（摘要/标签/实体）后再提问。",
    "parse_gate_blocked": "所选资料解析未通过（如扫描版 PDF），请重传可搜索文本或 txt/md 后再提问。",
}


def notes_ask_value_error_sse_event(code: str) -> dict[str, Any]:
    """校验类 ValueError → SSE error 行（与 iter 内模型错误形态一致）。"""
    c = (code or "").strip()[:200] or "invalid_request"
    msg = _NOTES_ASK_VALUE_ERROR_MESSAGES.get(c, c)
    return {"type": "error", "message": msg, "code": c}


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
    chat_history: list[dict[str, str]] | None = None,
    include_all_sources: bool | None = None,
    require_preprocess_ready: bool | None = None,
    prepared_messages_sources: (
        tuple[list[dict[str, str]], list[dict[str, Any]], dict[str, Any]] | None
    ) = None,
    project_owner_user_uuid: str | None = None,
    request_id: str | None = None,
) -> Iterator[dict[str, Any]]:
    """SSE 事件：chunk / done / followups / error。

    若调用方已通过 `_prepare_notes_ask_messages` 得到 messages/sources，可传入
    `prepared_messages_sources`，避免与校验阶段重复执行向量检索（此前流式接口会构建两遍上下文）。
    `request_id` 用于 error 事件与日志关联（通常取 X-Request-ID）。
    """
    qa_plan: dict[str, Any] = {}
    if prepared_messages_sources is not None:
        messages, sources, qa_plan = prepared_messages_sources
    else:
        messages, sources, qa_plan = _prepare_notes_ask_messages(
            notebook=notebook,
            note_ids=note_ids,
            question=question,
            user_ref=user_ref,
            chat_history=chat_history,
            require_preprocess_ready=require_preprocess_ready,
            project_owner_user_uuid=project_owner_user_uuid,
        )
    acc_answer: list[str] = []
    try:
        _t_llm = time.perf_counter()
        rid = (request_id or "").strip() or "-"
        logger.info(
            "notes_ask_stage stage=llm_request_start request_id=%s message_count=%s",
            rid,
            len(messages),
        )
        saw_visible = False
        reasoning_cap = _notes_ask_reasoning_stream_cap_chars()
        reasoning_emitted = 0
        stream_chunks_out = 0

        def _clip_reasoning(vis: str) -> str:
            nonlocal reasoning_emitted
            if reasoning_emitted >= reasoning_cap:
                return ""
            room = reasoning_cap - reasoning_emitted
            if len(vis) <= room:
                reasoning_emitted += len(vis)
                return vis
            if room <= 1:
                reasoning_emitted = reasoning_cap
                return "…" if room == 1 else ""
            out = vis[: room - 1] + "…"
            reasoning_emitted = reasoning_cap
            return out

        llm_temp = notes_ask_temperature()
        llm_max_tokens = notes_ask_max_output_tokens()
        try:
            for role, piece in invoke_llm_chat_messages_stream_segments_iter(
                    messages,
                    temperature=llm_temp,
                    api_key=api_key,
                    timeout_sec=120,
                    max_tokens=llm_max_tokens,
                ):
                    vis = _notes_ask_sanitize_visible_text(piece)
                    if not vis:
                        continue
                    is_reasoning = str(role or "").strip().lower() == "reasoning"
                    if is_reasoning:
                        clipped = _clip_reasoning(vis)
                        if not clipped:
                            continue
                        ev_out: dict[str, Any] = {"type": "chunk", "text": clipped, "streamRole": "reasoning"}
                    else:
                        acc_answer.append(vis)
                        ev_out = {"type": "chunk", "text": vis, "streamRole": "answer"}
                    if not saw_visible:
                        ttft_ms = (time.perf_counter() - _t_llm) * 1000.0
                        notes_ask_profile_emit(
                            "stream_llm_ttft_ms",
                            ttft_ms,
                        )
                        logger.info(
                            "notes_ask_stage stage=llm_first_token request_id=%s elapsed_ms=%.1f",
                            rid,
                            ttft_ms,
                        )
                        saw_visible = True
                    yield ev_out
                    stream_chunks_out += 1
        except Exception as seg_exc:
            if stream_chunks_out == 0:
                logger.warning(
                    "notes_ask_stream_segments_failed_no_output request_id=%s fallback_plain_stream: %s",
                    rid,
                    seg_exc,
                )
                for piece in invoke_llm_chat_messages_stream_iter(
                    messages,
                    temperature=llm_temp,
                    api_key=api_key,
                    timeout_sec=120,
                    max_tokens=llm_max_tokens,
                ):
                    vis = _notes_ask_sanitize_visible_text(piece)
                    if not vis:
                        continue
                    if not saw_visible:
                        ttft_ms = (time.perf_counter() - _t_llm) * 1000.0
                        notes_ask_profile_emit(
                            "stream_llm_ttft_ms",
                            ttft_ms,
                        )
                        logger.info(
                            "notes_ask_stage stage=llm_first_token request_id=%s elapsed_ms=%.1f",
                            rid,
                            ttft_ms,
                        )
                        saw_visible = True
                    acc_answer.append(vis)
                    yield {"type": "chunk", "text": vis}
                    stream_chunks_out += 1
            else:
                raise seg_exc
        llm_total_ms = (time.perf_counter() - _t_llm) * 1000.0
        notes_ask_profile_emit(
            "stream_llm_total_ms",
            llm_total_ms,
            visible_chars=len("".join(acc_answer)),
        )
        logger.info(
            "notes_ask_stage stage=llm_stream_done request_id=%s elapsed_ms=%.1f visible_chars=%s",
            rid,
            llm_total_ms,
            len("".join(acc_answer)),
        )
        full = finalize_notes_ask_answer("".join(acc_answer))
        if not full:
            raise RuntimeError("empty_answer")
        sources = filter_sources_by_citations(full, sources, include_all_sources=include_all_sources)
        done_ev: dict[str, Any] = {
            "type": "done",
            "sources": sources,
            "answer": full,
            "traceId": None,
            "qaMode": qa_plan.get("qaMode"),
            "grounding": qa_plan.get("grounding"),
            "lowConfidence": bool(qa_plan.get("lowConfidence")),
            "routedChapters": qa_plan.get("routedChapters") or [],
            "routedShards": qa_plan.get("routedShards") or [],
            "coverageHint": qa_plan.get("coverageHint") or "",
            "activeChapters": qa_plan.get("routedChapters") or [],
            "activeShards": qa_plan.get("routedShards") or [],
        }
        yield done_ev
        try:
            followup = generate_notes_ask_followup(
                question=question,
                answer=full,
                chat_history=chat_history,
                api_key=api_key,
            )
            if followup:
                yield {"type": "followups", "followUpQuestions": [followup]}
        except Exception as fu_exc:
            logger.warning(
                "notes_ask_followup_failed request_id=%s: %s",
                rid,
                fu_exc,
            )
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
    question: str | None = None,
    project_owner_user_uuid: str | None = None,
) -> tuple[str, list[dict[str, str]]]:
    """前缀截断合并（无向量索引时的回退）。"""
    nb = notebook.strip()
    if not nb:
        raise ValueError("notebook_required")
    ordered = _ordered_note_ids(note_ids)
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
        chunk = _question_snippet_windows(text, question or "", cap) if text else ""
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
    top_k: int | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    优先：异步摘要 + 勾选范围内向量检索；若无索引块则回退 legacy 前缀截断。
    """
    q = (question or "").strip()
    ordered = _ordered_note_ids(note_ids)
    cache_key = _notes_ask_context_cache_key(
        notebook=notebook,
        ordered_note_ids=ordered,
        user_ref=user_ref,
        project_owner_user_uuid=project_owner_user_uuid,
        question=q,
    )
    cached = _notes_ask_context_cache_get(cache_key)
    if cached is not None:
        return cached

    if top_k is None:
        top_k, _at = resolve_retrieval_top_k(q)
    if NOTE_LAYERED_RAG and q:
        layered, sources, meta = build_layered_notes_context(
            notebook=notebook,
            note_ids=ordered,
            query=q,
            user_ref=user_ref,
            summary_budget=14_000,
            retrieval_budget=36_000,
            top_k=top_k,
            project_owner_user_uuid=project_owner_user_uuid,
            merge_adjacent_chunks=merge_adjacent_chunks_enabled(),
        )
        if layered:
            rcm = meta.get("retrieval_chunks_meta")
            if isinstance(rcm, list) and rcm:
                sources = _enrich_sources_with_chunks(sources, rcm)
            _notes_ask_context_cache_set(cache_key, layered, sources)
            return layered, sources
    _t_leg = time.perf_counter()
    legacy_out = legacy_build_notes_qa_context(
        notebook=notebook,
        note_ids=ordered,
        user_ref=user_ref,
        question=q,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    notes_ask_profile_emit(
        "prepare_legacy_context_ms",
        (time.perf_counter() - _t_leg) * 1000.0,
        note_ids_n=len(note_ids),
    )
    _notes_ask_context_cache_set(cache_key, legacy_out[0], legacy_out[1])
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
    q_for_context = "请概括这些资料的共同主题、关键观点、事实线索与关键术语。"
    context, _sources = build_notes_qa_context(
        notebook=nb,
        note_ids=note_ids,
        user_ref=user_ref,
        question=q_for_context,
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


_FOLLOWUPS_SYSTEM = (
    "你是资料问答助手。根据本轮用户问题与助手回答，生成 1 条用户可继续向资料助手追问的中文问句。"
    "仅输出 JSON 对象，不要 markdown 围栏、不要 JSON 外文字。\n"
    '结构：{"followUpQuestion":"…"} 。\n'
    "要求：问句须能从用户已勾选资料中找到回答依据；不超过 48 字；"
    "应深化、补充边界、对比或应用上一步结论，勿重复用户原问题或回答的标题式复述；"
    '若无法提出有意义的延展，输出 {"followUpQuestion":""}。'
)


def generate_notes_ask_followup(
    *,
    question: str,
    answer: str,
    chat_history: list[dict[str, str]] | None = None,
    api_key: str | None = None,
) -> str:
    """答后单条关联问句；失败或不可延展时返回空字符串。"""
    if not followups_enabled():
        return ""
    q = (question or "").strip()
    a = (answer or "").strip()
    if not q or len(a) < followup_min_answer_chars():
        return ""
    history_block = _build_history_block(chat_history)
    user_parts = [
        f"用户问题：{q[:800]}",
        f"助手回答：{a[:2400]}",
    ]
    if history_block:
        user_parts.append(history_block[:900])
    user_parts.append("请输出 JSON。")
    messages = [
        {"role": "system", "content": _FOLLOWUPS_SYSTEM},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]
    try:
        raw, _trace = invoke_llm_chat_messages_with_minimax_fallback(
            messages,
            temperature=0.35,
            api_key=api_key,
            timeout_sec=45,
            max_tokens=160,
        )
    except Exception as exc:
        logger.warning("notes_ask_followup_llm_failed: %s", exc)
        return ""
    return parse_followup_json(raw)


def answer_notes_question(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    api_key: str | None = None,
    chat_history: list[dict[str, str]] | None = None,
    include_all_sources: bool | None = None,
    require_preprocess_ready: bool | None = None,
    project_owner_user_uuid: str | None = None,
) -> dict[str, Any]:
    messages, sources, qa_plan = _prepare_notes_ask_messages(
        notebook=notebook,
        note_ids=note_ids,
        question=question,
        user_ref=user_ref,
        chat_history=chat_history,
        require_preprocess_ready=require_preprocess_ready,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    try:
        answer, trace_id = invoke_llm_chat_messages_with_minimax_fallback(
            messages,
            temperature=notes_ask_temperature(),
            api_key=api_key,
            timeout_sec=120,
            max_tokens=notes_ask_max_output_tokens(),
        )
    except Exception as exc:
        logger.warning("notes_ask_llm_failed: %s", exc)
        raise
    if not (answer or "").strip():
        raise RuntimeError("empty_answer")

    ans = finalize_notes_ask_answer(answer)
    out: dict[str, Any] = {
        "answer": ans,
        "sources": filter_sources_by_citations(ans, sources, include_all_sources=include_all_sources),
        "traceId": trace_id,
        "qaMode": qa_plan.get("qaMode"),
        "grounding": qa_plan.get("grounding"),
        "routedChapters": qa_plan.get("routedChapters") or [],
        "routedShards": qa_plan.get("routedShards") or [],
        "coverageHint": qa_plan.get("coverageHint") or "",
        "activeChapters": qa_plan.get("routedChapters") or [],
        "activeShards": qa_plan.get("routedShards") or [],
    }
    followup = generate_notes_ask_followup(
        question=question,
        answer=ans,
        chat_history=chat_history,
        api_key=api_key,
    )
    if followup:
        out["followUpQuestions"] = [followup]
    return out
