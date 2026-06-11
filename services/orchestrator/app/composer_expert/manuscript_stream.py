"""Studio 成稿/改版 SSE：流式写画布，Job 仅作可选持久化尾巴。"""
from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any, Callable

from ..social_llm_utils import extract_partial_social_json_fields
from ..social_publish_draft import resolve_social_publish_material
from ..studio.agent_route import compose_soft_failure_code
from .generate import (
    _compose_expert_material_text,
    _compose_expert_writer_instructions,
    _ensure_intake_from_task,
    _intake_human_summary,
    _intake_to_social_options,
    _looks_like_xhs_template_body,
    _xhs_compose_must_include,
    generate_xhs_expert_deliverable,
)

_COMPOSE_WAIT_HEARTBEATS = (
    "正在生成完整成稿…",
    "模型撰写中，请稍候…",
    "仍在撰写，首个预览即将出现…",
)
_COMPOSE_WAIT_POLL_SECONDS = 5.0
_COMPOSE_WAIT_HEARTBEAT_SECONDS = 12.0
_COMPOSE_WAIT_DEADLINE_SECONDS = 180.0


def iter_compose_queue_events(
    event_q: queue.Queue[tuple[str, Any]],
    *,
    deadline_seconds: float = _COMPOSE_WAIT_DEADLINE_SECONDS,
) -> Iterator[tuple[str, Any]]:
    """轮询 compose worker 队列；空闲时周期性产出 heartbeat phase。"""
    deadline_at = time.perf_counter() + deadline_seconds
    heartbeat_idx = 0
    last_heartbeat_at = time.perf_counter()
    while True:
        remaining = deadline_at - time.perf_counter()
        if remaining <= 0:
            yield ("error", "生成超时")
            return
        try:
            yield event_q.get(timeout=min(_COMPOSE_WAIT_POLL_SECONDS, remaining))
        except queue.Empty:
            now = time.perf_counter()
            if now - last_heartbeat_at < _COMPOSE_WAIT_HEARTBEAT_SECONDS:
                continue
            msg = _COMPOSE_WAIT_HEARTBEATS[
                min(heartbeat_idx, len(_COMPOSE_WAIT_HEARTBEATS) - 1)
            ]
            heartbeat_idx += 1
            last_heartbeat_at = now
            yield ("phase", msg)


def deliverable_to_manuscript_blocks_dict(deliverable: dict[str, Any]) -> list[dict[str, Any]]:
    """Expert deliverable → 前端 ManuscriptBlock 列表（Studio Agent done 事件）。"""
    content = deliverable.get("content") if isinstance(deliverable.get("content"), dict) else {}
    content.pop("_rawBodiesCount", None)
    titles = content.get("titles") if isinstance(content.get("titles"), list) else []
    body = str(content.get("body") or "").strip()
    tags = content.get("hashtags") if isinstance(content.get("hashtags"), list) else []
    cover = content.get("cover") if isinstance(content.get("cover"), dict) else {}
    cover_hook = str(cover.get("headline") or cover.get("hook") or "").strip()
    bodies = content.get("bodies") if isinstance(content.get("bodies"), list) else []
    interactions = content.get("interactions") if isinstance(content.get("interactions"), list) else []
    interaction = str(content.get("interaction") or "").strip()
    directions = content.get("directions") if isinstance(content.get("directions"), list) else []
    return partial_social_to_manuscript_blocks(
        {
            "titles": titles,
            "bodies": bodies,
            "body": body,
            "tags": tags,
            "interactions": interactions,
            "interaction": interaction,
            "cover_hook": cover_hook,
            "directions": directions,
        }
    )


def partial_social_to_manuscript_blocks(partial: dict[str, Any]) -> list[dict[str, Any]]:
    """将流式 JSON 片段转为前端 ManuscriptBlock 形状（单稿）。"""
    blocks: list[dict[str, Any]] = []

    title = ""
    titles_raw = partial.get("titles")
    if isinstance(titles_raw, list):
        for raw in titles_raw:
            text = str(raw or "").strip()
            if text:
                title = text
                break
    if not title:
        title = str(partial.get("title") or "").strip()
    if title:
        blocks.append({"id": "title-0", "kind": "title", "text": title, "evidence": "model"})

    body = str(partial.get("body") or "").strip()
    if not body:
        bodies_raw = partial.get("bodies")
        if isinstance(bodies_raw, list):
            for raw in bodies_raw:
                text = str(raw or "").strip()
                if text:
                    body = text
                    break
    if body:
        blocks.append({"id": "body-0", "kind": "body", "text": body, "evidence": "model"})

    tags_raw = partial.get("tags")
    if isinstance(tags_raw, list):
        tags = [str(t).replace("#", "").strip() for t in tags_raw if str(t).strip()]
        if tags:
            blocks.append({"id": "hashtags-0", "kind": "hashtags", "tags": tags[:12]})

    interaction = str(partial.get("interaction") or "").strip()
    if not interaction:
        interactions_raw = partial.get("interactions")
        if isinstance(interactions_raw, list):
            for raw in interactions_raw:
                text = str(raw or "").strip()
                if text:
                    interaction = text
                    break
    if interaction:
        blocks.append({"id": "interaction-0", "kind": "interaction", "text": interaction})

    cover_hook = str(partial.get("cover_hook") or partial.get("theme") or "").strip()
    if cover_hook:
        blocks.append({"id": "coverBrief", "kind": "coverBrief", "text": cover_hook[:240]})
    return blocks


def _sse(data: dict[str, Any]) -> str:
    return "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"


def _prepare_material(
    *,
    payload: dict[str, Any],
    user_ref: str,
    task_sentence: str,
    intake: dict[str, Any],
    on_progress: Callable[[str], None] | None = None,
) -> tuple[str, dict[str, Any], str, int, bool]:
    notebook = str(payload.get("notes_notebook") or payload.get("notebook") or "").strip()
    nids = [
        str(x).strip()
        for x in (payload.get("selected_note_ids") or payload.get("noteIds") or [])
        if str(x).strip()
    ]
    used_rag = bool(nids) and bool(payload.get("use_rag", True))

    style_bits = [
        str(payload.get("style_prompt") or payload.get("stylePrompt") or "").strip(),
        str(payload.get("author_prompt") or payload.get("authorPrompt") or "").strip(),
    ]
    style_prompt = style_bits[0]
    author_prompt = style_bits[1]
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    feature_summary = " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]
    options = _intake_to_social_options(intake, task_sentence)
    writer_instructions = _compose_expert_writer_instructions(
        task_sentence=task_sentence, intake=intake, used_rag=used_rag
    )
    other_req = "\n\n".join(
        x for x in [writer_instructions, *style_bits, _intake_human_summary(intake)] if x
    )
    if other_req:
        persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
        persona["otherRequirements"] = other_req[:1600]
        options["persona"] = persona
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
    extras["mustInclude"] = _xhs_compose_must_include(intake, task_sentence)
    options["extras"] = extras

    if on_progress:
        on_progress("正在检索资料…" if nids else "正在准备创作任务…")

    hint = other_req[:500]
    owner = str(payload.get("notes_source_owner_user_id") or "").strip() or None
    try:
        rag_cap = int(payload.get("rag_max_chars") or 56_000)
    except (TypeError, ValueError):
        rag_cap = 56_000

    if nids:
        material = resolve_social_publish_material(
            user_ref,
            selected_note_ids=nids,
            material_text=task_sentence,
            notes_source_owner_user_id=owner,
            use_rag=used_rag,
            rag_max_chars=rag_cap,
            reference_rag_mode=str(payload.get("reference_rag_mode") or "truncate"),
            material_hint=hint,
            source_type=str(payload.get("source_type") or "notes_rag"),
        )
    else:
        material = _compose_expert_material_text(
            task_sentence=task_sentence,
            intake=intake,
            style_prompt=style_prompt,
            author_prompt=author_prompt,
            feature_summary=feature_summary,
        )
        if len(material.strip()) < 8:
            raise ValueError("material_too_short")

    if on_progress:
        on_progress("正在撰写完整成稿…")

    return material, options, notebook, len(nids), used_rag


def iter_studio_manuscript_stream(
    *,
    payload: dict[str, Any],
    user_ref: str,
) -> Iterator[str]:
    """SSE 生成器：phase | blocks | done | error。"""
    rid = str(uuid.uuid4())
    t0 = time.perf_counter()
    yield ": stream-open\n\n"

    task_sentence = str(payload.get("taskSentence") or payload.get("task_sentence") or "").strip()
    if not task_sentence:
        yield _sse({"type": "error", "message": "task_sentence_required", "requestId": rid})
        return

    intake_raw = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    intake = _ensure_intake_from_task(intake_raw, task_sentence)
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    feature_summary = " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]

    yield _sse({"type": "phase", "message": "正在整理任务与资料…", "requestId": rid})

    try:
        material, options, notebook, note_count, used_rag = _prepare_material(
            payload=payload,
            user_ref=user_ref,
            task_sentence=task_sentence,
            intake=intake,
            on_progress=lambda msg: None,
        )
    except ValueError as exc:
        yield _sse({"type": "error", "message": str(exc), "requestId": rid})
        return
    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)[:500], "requestId": rid})
        return

    yield _sse({"type": "phase", "message": "正在撰写完整成稿…", "requestId": rid})

    event_q: queue.Queue[tuple[str, Any]] = queue.Queue()
    last_blocks_sig = [""]

    def on_stream_delta(acc: str) -> None:
        partial = extract_partial_social_json_fields(acc)
        if not partial:
            return
        blocks = partial_social_to_manuscript_blocks(partial)
        if not blocks:
            return
        sig = json.dumps(blocks, ensure_ascii=False, sort_keys=True)
        if sig == last_blocks_sig[0]:
            return
        last_blocks_sig[0] = sig
        event_q.put(("blocks", blocks))

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
                    event_q.put(("error", compose_soft_failure_code(task_sentence)))
                    return
                event_q.put(("done", deliverable))
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

    deliverable: dict[str, Any] | None = None
    for kind, payload_item in iter_compose_queue_events(event_q):
        if kind == "phase":
            yield _sse({"type": "phase", "message": str(payload_item), "requestId": rid})
        elif kind == "blocks":
            yield _sse({"type": "blocks", "blocks": payload_item, "requestId": rid})
        elif kind == "error":
            yield _sse({"type": "error", "message": str(payload_item), "requestId": rid})
            return
        elif kind == "done":
            deliverable = payload_item if isinstance(payload_item, dict) else None
            break

    if not deliverable:
        yield _sse({"type": "error", "message": "生成失败", "requestId": rid})
        return

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    yield _sse(
        {
            "type": "done",
            "deliverable": deliverable,
            "requestId": rid,
            "elapsedMs": elapsed_ms,
        }
    )
