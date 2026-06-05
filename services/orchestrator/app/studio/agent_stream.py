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
    partial_social_to_manuscript_blocks,
)
from ..social_llm_utils import extract_partial_social_json_fields, invoke_social_llm
from .agent_route import (
    build_task_sentence_from_turns,
    is_insufficient_brief,
    reply_for_blocking,
    route_studio_agent,
)


def _short_coach_reply(message: str, *, has_manuscript: bool) -> str:
    system = (
        "你是小红书创作助手。用不超过120字中文直接回答用户问题。"
        "不要输出完整笔记正文；不要 JSON。若用户应改稿，提示其在输入框描述改版意见。"
    )
    if has_manuscript:
        system += "当前已有稿件在画布，可结合改稿建议作答。"
    try:
        raw, _ = invoke_social_llm(system, message.strip()[:800], max_tokens=220)
        text = str(raw or "").strip()
        if text:
            return text[:480]
    except Exception:
        pass
    return "可以在下方输入更具体的改稿意见，我会直接在画布上修改稿件。"


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
    task_sentence = str(payload.get("taskSentence") or "").strip() or build_task_sentence_from_turns(turns)

    tool = route_studio_agent(
        message=message,
        status=status,
        version_count=version_count,
        task_sentence=task_sentence,
    )

    if tool == "reply":
        if is_insufficient_brief(message) and version_count == 0:
            text = reply_for_blocking(message)
        else:
            text = _short_coach_reply(message, has_manuscript=version_count > 0)
        yield _sse({"type": "reply", "text": text, "requestId": rid})
        yield _sse(
            {
                "type": "done",
                "tool": "reply",
                "requestId": rid,
                "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1),
            }
        )
        return

    intake_raw = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    intake = _ensure_intake_from_task(intake_raw, task_sentence or message)
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    feature_summary = " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]

    if tool == "revise":
        task_sentence = str(payload.get("taskSentence") or task_sentence).strip() or message
    elif not task_sentence.strip():
        task_sentence = message

    stream_payload = {
        **payload,
        "taskSentence": task_sentence,
        "task_sentence": task_sentence,
        "intake": intake,
        "expertId": "xhs_ops",
    }
    if stream_payload.get("noteIds"):
        stream_payload["source_type"] = "notes_rag"
        stream_payload["selected_note_ids"] = stream_payload["noteIds"]
        stream_payload["notes_notebook"] = stream_payload.get("notebook") or ""

    yield _sse({"type": "phase", "message": "开始写稿…", "requestId": rid, "tool": tool})

    try:
        material, options, notebook, note_count, used_rag = _prepare_material(
            payload=stream_payload,
            user_ref=user_ref,
            task_sentence=task_sentence,
            intake=intake,
            on_progress=lambda _m: None,
        )
    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)[:500], "requestId": rid})
        return

    event_q: queue.Queue[tuple[str, Any]] = queue.Queue()
    last_sig = [""]

    def on_stream_delta(acc: str) -> None:
        partial = extract_partial_social_json_fields(acc)
        if not partial:
            return
        blocks = partial_social_to_manuscript_blocks(partial)
        if not blocks:
            return
        sig = json.dumps(blocks, ensure_ascii=False, sort_keys=True)
        if sig == last_sig[0]:
            return
        last_sig[0] = sig
        event_q.put(("block_delta", blocks))

    def worker() -> None:
        last_errors: list[str] = []
        for attempt in range(3):
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
                    on_stream_delta=on_stream_delta,
                    validation_errors=last_errors or None,
                )
                content = deliverable.get("content") if isinstance(deliverable.get("content"), dict) else {}
                if _looks_like_xhs_template_body(content, task_sentence):
                    event_q.put(("error", "成稿像是通用模板，请补充受众、卖点与场景后重试"))
                    return
                blocks = deliverable_to_manuscript_blocks_dict(deliverable)
                event_q.put(("done", {"tool": tool, "blocks": blocks}))
                return
            except ValueError as exc:
                err = str(exc)
                if err.startswith("validation_failed:") and attempt < 2:
                    last_errors = err.split(":", 1)[1].split("|")
                    event_q.put(("phase", "正在优化文稿…"))
                    continue
                event_q.put(("error", err[:500]))
                return
            except Exception as exc:
                event_q.put(("error", str(exc)[:500]))
                return
        event_q.put(("error", "生成失败"))

    threading.Thread(target=worker, daemon=True).start()

    while True:
        try:
            kind, item = event_q.get(timeout=180.0)
        except queue.Empty:
            yield _sse({"type": "error", "message": "生成超时", "requestId": rid})
            return
        if kind == "phase":
            yield _sse({"type": "phase", "message": str(item), "requestId": rid, "tool": tool})
        elif kind == "block_delta":
            yield _sse({"type": "block_delta", "blocks": item, "requestId": rid, "tool": tool})
        elif kind == "error":
            yield _sse({"type": "error", "message": str(item), "requestId": rid})
            return
        elif kind == "done":
            data = item if isinstance(item, dict) else {}
            blocks = data.get("blocks") if isinstance(data.get("blocks"), list) else []
            yield _sse(
                {
                    "type": "done",
                    "tool": data.get("tool") or tool,
                    "blocks": blocks,
                    "requestId": rid,
                    "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1),
                }
            )
            return
