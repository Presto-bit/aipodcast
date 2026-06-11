"""Studio 单 Agent SSE：reply | block_delta | done（仅 blocks，无 Ops/Job）。"""
from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

from ..composer_expert.generate import (
    _ensure_intake_from_task,
    _looks_like_xhs_template_body,
    generate_xhs_expert_deliverable,
)
from ..composer_expert.manuscript_stream import (
    _prepare_material,
    _sse,
    deliverable_to_manuscript_blocks_dict,
    iter_compose_queue_events,
    partial_social_to_manuscript_blocks,
)
from ..social_llm_utils import extract_partial_social_json_fields
from .studio_constants import (
    STUDIO_CORPUS_MAX_NOTE_IDS,
    STUDIO_MANUSCRIPT_EXCERPT_CHARS,
    STUDIO_USER_REPLY_MAX_CHARS,
)
from .studio_reply import generate_studio_reply
from .studio_corpus_snippet import fetch_reply_corpus_excerpt
from .agent_route import (
    build_compose_task_sentence,
    compose_soft_failure_code,
    is_insufficient_brief,
    reply_for_blocking,
)
from .agent_tool_router import StudioToolDecision
from .agent_loop import manuscript_plain_from_payload, run_agent_tool_loop
from .studio_brief import build_compose_brief_from_work, build_revise_task_in_executor
from .studio_patch_blocks import execute_patch_blocks
from .studio_revise_scope import is_local_patch_scope
from .domain_profile import (
    apply_domain_compose_intake,
    compose_writer_preamble,
    domain_author_overlay,
    expert_id_for_payload,
)
from .agent_tool_schema import normalize_agent_mode
from .patch_utils import build_pending_patch_payload

STUDIO_NEEDS_BRIEF = "NEEDS_BRIEF"
STUDIO_NEEDS_REWRITE = "NEEDS_REWRITE"


def _compose_soft_failure_code(task_sentence: str) -> str:
    return compose_soft_failure_code(task_sentence)


def _cap_stream_note_ids(payload: dict[str, Any]) -> tuple[dict[str, Any], int, int]:
    """限制 RAG 资料篇数，返回 (payload, 原始篇数, 实际篇数)。"""
    raw = payload.get("noteIds") or payload.get("selected_note_ids") or []
    if not isinstance(raw, list):
        return payload, 0, 0
    nids = [str(x).strip() for x in raw if str(x).strip()]
    if not nids:
        return payload, 0, 0
    capped = nids[:STUDIO_CORPUS_MAX_NOTE_IDS]
    if capped == nids:
        return payload, len(nids), len(capped)
    return (
        {**payload, "noteIds": capped, "selected_note_ids": capped},
        len(nids),
        len(capped),
    )


def iter_studio_agent_stream(*, payload: dict[str, Any], user_ref: str) -> Iterator[str]:
    rid = str(uuid.uuid4())
    t0 = time.perf_counter()
    yield ": stream-open\n\n"
    yield _sse({"type": "session", "requestId": rid})

    message = str(payload.get("message") or payload.get("userMessage") or "").strip()
    if not message:
        yield _sse({"type": "error", "message": "message_required", "requestId": rid})
        return

    turns = payload.get("agentTurns") if isinstance(payload.get("agentTurns"), list) else []
    status = str(payload.get("status") or "draft").strip()
    version_count = int(payload.get("versionCount") or 0)
    agent_mode = normalize_agent_mode(
        str(payload.get("agentMode") or payload.get("agent_mode") or "write")
    )
    force_compose = bool(payload.get("forceCompose"))
    selection_snippet = str(payload.get("selectionSnippet") or "").strip()
    has_pending_patch = bool(payload.get("pendingPatch"))

    pending_steps: list[dict[str, Any]] = []

    def emit_step(
        step_id: str,
        label: str,
        status: str,
        tool: str | None,
        detail: str = "",
    ) -> None:
        pending_steps.append(
            {
                "type": "step",
                "id": step_id,
                "label": label,
                "status": status,
                "tool": tool or "",
                "reason": detail[:480] if detail else "",
                "detail": detail[:480] if detail else "",
                "requestId": rid,
            }
        )

    yield _sse({"type": "phase", "message": "正在理解你的指令…", "requestId": rid})

    loop_result = run_agent_tool_loop(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        payload={
            **payload,
            "agentMode": agent_mode,
            "forceCompose": force_compose,
            "selectionSnippet": selection_snippet,
            "pendingPatch": has_pending_patch,
        },
        emit_step=emit_step,
    )
    for step_ev in pending_steps:
        yield _sse(step_ev)

    decision = loop_result.decision
    tool = decision.tool
    manuscript_excerpt = loop_result.manuscript_excerpt

    tool_call_payload = {
        "type": "tool_call",
        "tool": tool,
        "brief": decision.brief[:500] if decision.brief else "",
        "reply": decision.reply_text[:STUDIO_USER_REPLY_MAX_CHARS] if decision.reply_text else "",
        "source": decision.source,
        "reason": decision.reason[:200],
        "mode": agent_mode,
        "domain": decision.domain or "",
        "format": decision.format or "",
        "assumptions": list(decision.assumptions),
        "reviseScope": {
            "blocks": list(decision.revise_blocks),
            "intent": decision.revise_intent,
            "fullRewrite": decision.full_rewrite,
        },
        "requestId": rid,
    }
    yield _sse(tool_call_payload)
    yield _sse({**tool_call_payload, "type": "route"})
    if decision.reason:
        yield _sse(
            {
                "type": "trace_step",
                "id": "route_decision",
                "tool": tool,
                "label": "决定下一步",
                "status": "done",
                "detail": decision.reason[:480],
                "requestId": rid,
            }
        )

    work_brief = str(payload.get("workBrief") or payload.get("brief") or "").strip()
    compose_brief = build_compose_brief_from_work(
        work_brief=work_brief,
        message=message,
        turns=turns,
    )

    if tool == "reply":
        if not manuscript_excerpt.strip() and version_count > 0:
            manuscript_excerpt = manuscript_plain_from_payload(
                payload, max_chars=STUDIO_MANUSCRIPT_EXCERPT_CHARS
            )
        feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
        feature_summary = " · ".join(
            str(feature_core.get(k) or "").strip()
            for k in ("who", "remember", "avoid")
            if str(feature_core.get(k) or "").strip()
        )[:80]
        if is_insufficient_brief(compose_brief) and version_count == 0:
            text = reply_for_blocking(compose_brief)
        else:
            corpus_excerpt = ""
            note_ids = payload.get("noteIds") or payload.get("selected_note_ids") or []
            if isinstance(note_ids, list) and note_ids:
                yield _sse(
                    {
                        "type": "phase",
                        "message": "正在检索相关资料…",
                        "requestId": rid,
                        "tool": "reply",
                    }
                )
                corpus_excerpt = fetch_reply_corpus_excerpt(
                    user_ref=user_ref,
                    payload=payload,
                    query=message,
                )
            text = generate_studio_reply(
                message,
                has_manuscript=version_count > 0,
                manuscript_excerpt=manuscript_excerpt,
                task_sentence=compose_brief,
                feature_summary=feature_summary,
                corpus_excerpt=corpus_excerpt,
            )
        text = text[:STUDIO_USER_REPLY_MAX_CHARS]
        yield _sse({"type": "reply", "text": text, "requestId": rid})
        yield _sse(
            {
                "type": "done",
                "tool": "reply",
                "domain": decision.domain or "",
                "format": decision.format or "",
                "assumptions": list(decision.assumptions),
                "requestId": rid,
                "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1),
            }
        )
        return

    planner_domain = str(decision.domain or payload.get("domain") or "general").strip()
    planner_format = str(decision.format or payload.get("format") or "general").strip()

    if tool == "revise" and version_count > 0:
        revise_scope = {
            "blocks": list(decision.revise_blocks),
            "intent": decision.revise_intent,
            "fullRewrite": decision.full_rewrite,
        }
        if is_local_patch_scope(revise_scope):
            from_blocks = [
                b for b in (payload.get("manuscriptBlocks") or []) if isinstance(b, dict)
            ]
            if not manuscript_excerpt.strip():
                manuscript_excerpt = manuscript_plain_from_payload(payload, max_chars=2400)
            yield _sse(
                {
                    "type": "phase",
                    "message": "正在修改指定块…",
                    "requestId": rid,
                    "tool": "revise",
                }
            )
            yield _sse(
                {
                    "type": "step",
                    "id": "patch_blocks",
                    "label": "块级改版",
                    "status": "running",
                    "tool": "revise",
                    "requestId": rid,
                }
            )
            proposed = execute_patch_blocks(
                message=message,
                from_blocks=from_blocks,
                revise_scope=revise_scope,
                selection_snippet=selection_snippet,
                domain=planner_domain,
            )
            from_version_id = str(payload.get("activeVersionId") or "").strip()
            patch = build_pending_patch_payload(
                from_version_id=from_version_id,
                from_blocks=from_blocks,
                proposed_blocks=proposed,
                message=message,
                reason=decision.reason or "块级改版",
                source_run_id=str(payload.get("clientRunId") or rid),
            )
            yield _sse(
                {
                    "type": "step",
                    "id": "patch_blocks",
                    "label": "块级改版",
                    "status": "done",
                    "tool": "revise",
                    "requestId": rid,
                }
            )
            yield _sse(
                {
                    "type": "patch_proposed",
                    "pendingPatch": patch,
                    "requestId": rid,
                    "tool": "revise",
                }
            )
            yield _sse(
                {
                    "type": "done",
                    "tool": "revise",
                    "outcome": "patch",
                    "blocks": proposed,
                    "silent": True,
                    "requestId": rid,
                    "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1),
                }
            )
            return

    intake_raw = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    if tool == "revise":
        if not manuscript_excerpt.strip():
            manuscript_excerpt = manuscript_plain_from_payload(payload, max_chars=2400)
        task_sentence = build_revise_task_in_executor(
            message=message,
            manuscript_excerpt=manuscript_excerpt,
            selection_snippet=selection_snippet,
            intent=decision.revise_intent,
        )
    elif tool == "compose":
        task_sentence = decision.brief.strip() or compose_brief
    else:
        task_sentence = decision.brief.strip() or message
    intake = _ensure_intake_from_task(intake_raw, task_sentence)
    intake = apply_domain_compose_intake(
        intake,
        domain=planner_domain,
        fmt=planner_format,
        task_sentence=task_sentence,
    )
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    feature_summary = " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]

    domain_overlay = domain_author_overlay({"domain": planner_domain, "format": planner_format})
    writer_preamble = compose_writer_preamble(planner_domain, planner_format)
    author_extra = str(payload.get("authorPrompt") or "").strip()
    merged_author = "\n\n".join(x for x in (author_extra, writer_preamble, domain_overlay) if x).strip()

    stream_payload = {
        **payload,
        "domain": planner_domain,
        "format": planner_format,
        "taskSentence": task_sentence,
        "task_sentence": task_sentence,
        "intake": intake,
        "authorPrompt": merged_author,
        "expertId": expert_id_for_payload({**payload, "domain": planner_domain}),
    }
    if stream_payload.get("noteIds"):
        stream_payload["source_type"] = "notes_rag"
        stream_payload["selected_note_ids"] = stream_payload["noteIds"]
        stream_payload["notes_notebook"] = stream_payload.get("notebook") or ""

    stream_payload, corpus_total, corpus_used = _cap_stream_note_ids(stream_payload)

    yield _sse({"type": "phase", "message": "开始写稿…", "requestId": rid, "tool": tool})
    yield _sse(
        {
            "type": "step",
            "id": "compose_stream",
            "label": "撰写成稿" if tool == "compose" else "按你的意见修改",
            "status": "running",
            "tool": tool,
            "requestId": rid,
        }
    )

    if corpus_used > 0 and corpus_total > corpus_used:
        yield _sse(
            {
                "type": "phase",
                "message": f"资料共 {corpus_total} 篇，先检索其中 {corpus_used} 篇…",
                "requestId": rid,
                "tool": tool,
            }
        )
    elif corpus_used > 0:
        yield _sse(
            {
                "type": "phase",
                "message": f"正在检索资料（{corpus_used} 篇）…",
                "requestId": rid,
                "tool": tool,
            }
        )

    prep_q: queue.Queue[tuple[str, Any]] = queue.Queue()

    def prep_worker() -> None:
        try:

            def on_progress(msg: str) -> None:
                text = str(msg or "").strip()
                if text:
                    prep_q.put(("phase", text))

            result = _prepare_material(
                payload=stream_payload,
                user_ref=user_ref,
                task_sentence=task_sentence,
                intake=intake,
                on_progress=on_progress,
            )
            prep_q.put(("done", result))
        except Exception as exc:
            prep_q.put(("error", str(exc)[:500]))

    threading.Thread(target=prep_worker, daemon=True).start()

    material: str | None = None
    options: dict[str, Any] | None = None
    notebook = ""
    note_count = 0
    used_rag = False
    prep_deadline = 300.0 if corpus_used > 0 else 120.0

    for kind, item in iter_compose_queue_events(prep_q, deadline_seconds=prep_deadline):
        if kind == "phase":
            yield _sse({"type": "phase", "message": str(item), "requestId": rid, "tool": tool})
        elif kind == "error":
            yield _sse({"type": "error", "message": str(item), "requestId": rid})
            return
        elif kind == "done":
            material, options, notebook, note_count, used_rag = item
            break
    else:
        yield _sse({"type": "error", "message": "资料检索超时", "requestId": rid})
        return

    if material is None or options is None:
        yield _sse({"type": "error", "message": "资料准备失败", "requestId": rid})
        return

    event_q: queue.Queue[tuple[str, Any]] = queue.Queue()
    last_sig = [""]
    last_body = [""]
    last_blocks: list[Any] = [None]

    def on_stream_delta(acc: str) -> None:
        partial = extract_partial_social_json_fields(acc)
        if not partial:
            return
        bodies = partial.get("bodies")
        body = ""
        if isinstance(bodies, list) and bodies:
            body = str(bodies[0] or "")
        if not body:
            body = str(partial.get("body") or "")
        if body and body != last_body[0]:
            last_body[0] = body
            event_q.put(("body_delta", body))
        blocks = partial_social_to_manuscript_blocks(partial)
        if not blocks:
            return
        sig = json.dumps(blocks, ensure_ascii=False, sort_keys=True)
        if sig == last_sig[0]:
            return
        last_sig[0] = sig
        last_blocks[0] = blocks
        event_q.put(("block_delta", blocks))

    def worker() -> None:
        last_errors: list[str] = []
        template_retry_done = False
        for attempt in range(3):
            last_sig[0] = ""
            last_body[0] = ""

            def on_attempt_delta(acc: str) -> None:
                on_stream_delta(acc)

            try:
                deliverable = generate_xhs_expert_deliverable(
                    task_sentence=task_sentence,
                    intake=intake,
                    material_text=material,
                    options=options,
                    notebook=notebook,
                    note_count=note_count,
                    used_rag=used_rag,
                    feature_summary=feature_summary,
                    on_stream_delta=on_attempt_delta,
                    validation_errors=last_errors or None,
                    domain=planner_domain,
                )
                content = deliverable.get("content") if isinstance(deliverable.get("content"), dict) else {}
                if _looks_like_xhs_template_body(content, task_sentence):
                    if not template_retry_done and attempt < 2:
                        template_retry_done = True
                        last_errors = [
                            "成稿过于模板化，请换开头钩子、段落结构与用词重写"
                        ]
                        event_q.put(("phase", "正在优化表述…"))
                        continue
                blocks = deliverable_to_manuscript_blocks_dict(deliverable)
                event_q.put(("done", {"tool": tool, "blocks": blocks}))
                return
            except ValueError as exc:
                err = str(exc)
                if err.startswith("validation_failed:") and attempt < 2:
                    last_errors = err.split(":", 1)[1].split("|")
                    event_q.put(("phase", "正在优化表述…"))
                    continue
                fallback = last_blocks[0] if isinstance(last_blocks[0], list) else []
                if fallback:
                    event_q.put(("done", {"tool": tool, "blocks": fallback}))
                    return
                event_q.put(("error", err[:500]))
                return
            except Exception as exc:
                event_q.put(("error", str(exc)[:500]))
                return
        event_q.put(("error", "生成失败"))

    threading.Thread(target=worker, daemon=True).start()

    for kind, item in iter_compose_queue_events(event_q):
        if kind == "phase":
            yield _sse({"type": "phase", "message": str(item), "requestId": rid, "tool": tool})
        elif kind == "body_delta":
            yield _sse({"type": "body_delta", "body": str(item), "requestId": rid, "tool": tool})
        elif kind == "block_delta":
            yield _sse({"type": "block_delta", "blocks": item, "requestId": rid, "tool": tool})
        elif kind == "stream_reset":
            yield _sse({"type": "stream_reset", "requestId": rid, "tool": tool})
        elif kind == "error":
            yield _sse({"type": "error", "message": str(item), "requestId": rid})
            return
        elif kind == "done":
            data = item if isinstance(item, dict) else {}
            blocks = data.get("blocks") if isinstance(data.get("blocks"), list) else []
            yield _sse(
                {
                    "type": "step",
                    "id": "compose_stream",
                    "label": "撰写成稿" if tool == "compose" else "按你的意见修改",
                    "status": "done",
                    "tool": tool,
                    "reason": decision.reason[:480] if decision.reason else "",
                    "detail": decision.reason[:480] if decision.reason else "",
                    "requestId": rid,
                }
            )
            from_blocks = (
                payload.get("manuscriptBlocks")
                if isinstance(payload.get("manuscriptBlocks"), list)
                else []
            )
            from_blocks = [b for b in from_blocks if isinstance(b, dict)]
            from_version_id = str(payload.get("activeVersionId") or "").strip()
            quality_note = ""
            body_text = ""
            for blk in blocks:
                if isinstance(blk, dict) and str(blk.get("kind") or "") == "body":
                    body_text = str(blk.get("text") or "")
                    break
            if body_text and _looks_like_xhs_template_body({"body": body_text}, task_sentence):
                quality_note = "开头略偏通用模板，可先采纳再改标题或开头"
            patch = build_pending_patch_payload(
                from_version_id=from_version_id,
                from_blocks=from_blocks,
                proposed_blocks=blocks,
                message=message,
                reason=decision.reason or ("首稿成稿" if tool == "compose" else "按意见改版"),
                source_run_id=str(payload.get("clientRunId") or rid),
                quality_note=quality_note,
            )
            yield _sse(
                {
                    "type": "patch_proposed",
                    "pendingPatch": patch,
                    "requestId": rid,
                    "tool": data.get("tool") or tool,
                }
            )
            yield _sse(
                {
                    "type": "done",
                    "tool": data.get("tool") or tool,
                    "outcome": "patch",
                    "blocks": blocks,
                    "silent": True,
                    "requestId": rid,
                    "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1),
                }
            )
            return
