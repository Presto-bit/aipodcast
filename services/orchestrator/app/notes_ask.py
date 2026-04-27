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


def _notes_ask_top_k() -> int:
    """向量检索 top_k 上限与默认；可用环境变量 NOTES_ASK_TOP_K 覆盖（24–160）。默认 56 平衡时延与召回。"""
    try:
        return max(24, min(160, int(os.getenv("NOTES_ASK_TOP_K", "56") or "56")))
    except (TypeError, ValueError):
        return 56


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


_SYSTEM = (
    "你是资料助手。用户提供了若干条笔记摘录（可能已截断）。请仅用这些材料回答问题；"
    "若材料不足以回答，请明确说明「材料中未提及」或「摘录中看不到」，不要编造事实。\n"
    "回答使用中文；正文使用 GitHub 风格 Markdown，便于扫读："
    "若不止一两句话，开头先用 1～3 句概括核心结论（可用 **加粗** 标出最关键一句），"
    "再用 ## 或 ### 小标题分节；步骤用有序列表，并列要点用无序列表，需要多列对比时用表格。\n"
    "不要输出模型内心独白式推理过程；避免大段「首先…其次…再者…」式推演铺陈，"
    "改用标题与列表直接呈现面向读者的结论与依据。\n"
    "来源角标仍只用 [1]、[2]…（与摘录或【来源清单】中的资料序号一致），勿发明新编号体系。\n"
    "仅在确实依据某一来源时，在对应句子或段末标注角标；不要标注未在回答中实际用到的序号；"
    "也不要在正文中复述「检索片段」、chunk、score、向量、noteId 等系统或调试用语。\n"
    "为便于读者核对「依据在摘录中的哪一段」：在事实性结论、数字、日期、专有名词或易歧义表述处，"
    "尽量在该句附近给出**很短的一句原话佐证**，用中文直角引号「」括起，须与摘录字面一致（可仅用省略号表示截断）；"
    "长度以约一句、一般不超过 40 字为宜，避免大段照抄；**短引文后再写角标 [n]**。"
    "若摘录中无合适短句、或概括性结论难以逐字对应，可仅用角标 [n] 而不强行造引文。\n"
    "若摘录内已有 Markdown 标题（如 ###）或「摘要 [i]」等小节，可在必要时用简短称谓点明段落（如资料标题、小节主题），再跟角标 [n]，勿复述块序号等技术标签。\n"
    "若模型接口将推理与正文分列返回，仅将面向用户的结论写在正文部分，勿在正文中重复粘贴完整推理过程。\n"
    "若问题与多条笔记均相关，请尽量在回答中分别引用不同序号，避免只依赖少数几条而忽略其他相关摘录。"
    "当勾选来源数 >= 2 且材料可支持时，优先至少引用 2 个不同来源；若只能依据 1 个来源作答，请明确说明其余来源中未检索到可支持该问题的片段。"
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
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
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

    history_block = _build_history_block(chat_history)
    user_block = (
        "资料摘录如下（角标 [n] 须与【来源清单】/摘录中的资料序号一致；关键处尽量用「」短引文后再标 [n]）：\n\n"
        f"{context}\n\n---\n\n"
        + (history_block + "\n\n---\n\n" if history_block else "")
        + f"问题：{q}"
    )
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_block},
    ]
    return messages, sources


_NOTES_ASK_VALUE_ERROR_MESSAGES: dict[str, str] = {
    "empty_context": "当前勾选资料没有可用于问答的正文（可能尚在解析/索引中）。请打开资料预览确认已有文字，或稍后再试。",
    "note_not_found": "部分资料已不存在或无权访问，请刷新列表后重新勾选。",
    "notebook_required": "请先选择笔记本。",
    "note_ids_required": "请至少勾选一条资料后再提问。",
    "question_required": "请输入问题。",
    "too_many_notes": "勾选的资料条数超过上限，请减少勾选后再试。",
    "note_notebook_mismatch": "勾选资料与当前笔记本不一致，请刷新后重选。",
    "preprocess_not_ready": "已开启严格准入：请等待所选资料完成预处理（摘要/标签/实体）后再提问。",
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

        try:
            for role, piece in invoke_llm_chat_messages_stream_segments_iter(
                messages,
                temperature=0.45,
                api_key=api_key,
                timeout_sec=120,
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
                    temperature=0.45,
                    api_key=api_key,
                    timeout_sec=120,
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
        full = _notes_ask_sanitize_visible_text("".join(acc_answer)).strip()
        if not full:
            raise RuntimeError("empty_answer")
        sources = filter_sources_by_citations(full, sources, include_all_sources=include_all_sources)
        done_ev: dict[str, Any] = {"type": "done", "sources": sources, "traceId": None}
        yield done_ev
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

    if NOTE_LAYERED_RAG and q:
        layered, sources, meta = build_layered_notes_context(
            notebook=notebook,
            note_ids=ordered,
            query=q,
            user_ref=user_ref,
            summary_budget=14_000,
            retrieval_budget=36_000,
            top_k=_notes_ask_top_k(),
            project_owner_user_uuid=project_owner_user_uuid,
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
    messages, sources = _prepare_notes_ask_messages(
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
    out: dict[str, Any] = {
        "answer": ans,
        "sources": filter_sources_by_citations(ans, sources, include_all_sources=include_all_sources),
        "traceId": trace_id,
    }
    return out
