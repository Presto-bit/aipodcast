"""
资料 Studio：基于 L0 + 片摘要生成大纲 / 测验 / 时间线等（不重扫全文）。
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from .db import get_conn, get_cursor
from .models import get_note_by_id
from .note_notebook_digest import build_notebook_digest_context, _max_notes as notebook_studio_max_notes
from .note_shards import list_shards
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_TASK_PROMPTS: dict[str, str] = {
    "outline": (
        "你是学习助手。根据全书概览与各部分摘要，输出 Markdown 章节大纲（层级标题 + 每节 1～2 句要点）。"
        "只使用给定摘要中的信息，不要编造。"
    ),
    "quiz": (
        "你是教师。根据给定部分摘要，出 5 道测验题（混合选择/简答），附简短参考答案并标明对应「部分」标题。"
        "不要编造摘要中没有的事实。"
    ),
    "timeline": (
        "你是编辑。从各部分摘要中提取带日期或时间顺序的事件，输出 JSON 数组："
        '[{"date":"...","event":"...","partTitle":"..."}]，最多 20 条。无日期则按逻辑顺序。只输出 JSON。'
    ),
    "brief": (
        "你是编辑。根据摘要写一份 1 页以内的学习简报（Markdown）：核心论点、关键事实、待进一步阅读的问题。"
        "只使用摘要内容。"
    ),
    "faq": (
        "你是教师。根据摘要列出 8～12 个常见问题与简短回答（Markdown Q&A 列表）。不要编造。"
    ),
    "flashcards": (
        "你是教师。输出 JSON 数组，每项 {\"front\":\"问题\",\"back\":\"答案\",\"partTitle\":\"部分标题\"}，共 10～16 张。"
        "只输出 JSON。"
    ),
    "mindmap": (
        "你是信息架构师。根据摘要输出思维导图 JSON："
        '{"title":"中心主题","children":[{"title":"分支","children":[]}]} ，最多 3 层。只输出 JSON。'
    ),
}


def studio_max_artifacts() -> int:
    try:
        return max(5, min(50, int(os.getenv("NOTE_STUDIO_MAX_ARTIFACTS", "20") or "20")))
    except (TypeError, ValueError):
        return 20


def _metadata_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _merge_note_metadata(note_id: str, patch: dict[str, Any]) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs
                SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s::uuid
                """,
                (json.dumps(patch, ensure_ascii=False), note_id),
            )
            conn.commit()


def _context_from_note(row: dict[str, Any], *, shard_ids: list[str] | None = None) -> str:
    md = _metadata_dict(row)
    l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
    parts: list[str] = []
    if l0:
        parts.append(f"## 全书概览\n\n{l0}")
    nid = str(row.get("id") or "")
    shards = list_shards(nid) if nid else []
    want = set(shard_ids or [])
    for sh in shards:
        sid = str(sh.get("shard_id") or "")
        if want and sid not in want:
            continue
        title = str(sh.get("title") or sid)
        summary = str(sh.get("summary_text") or "").strip()
        if summary:
            parts.append(f"## {title}\n\n{summary}")
    return "\n\n---\n\n".join(parts)[:44_000]


def _append_artifact(note_id: str, artifact: dict[str, Any]) -> None:
    row = get_note_by_id(note_id)
    if not row:
        return
    md = _metadata_dict(row)
    arts = md.get("studioArtifacts")
    if not isinstance(arts, list):
        arts = []
    arts = [a for a in arts if isinstance(a, dict)]
    arts.insert(0, artifact)
    arts = arts[: studio_max_artifacts()]
    _merge_note_metadata(note_id, {"studioArtifacts": arts})


def list_studio_artifacts(note_id: str, *, user_ref: str | None) -> list[dict[str, Any]]:
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return []
    md = _metadata_dict(row)
    arts = md.get("studioArtifacts")
    return [a for a in arts if isinstance(a, dict)] if isinstance(arts, list) else []


def run_note_studio(
    note_id: str,
    task: str,
    *,
    user_ref: str | None,
    shard_ids: list[str] | None = None,
    api_key: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """task: outline | quiz | timeline | brief | faq | flashcards | mindmap"""
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return {"ok": False, "error": "note_not_found"}
    ctx = _context_from_note(row, shard_ids=shard_ids)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries", "hint": "请先完成资料索引与片摘要"}

    t = (task or "").strip().lower()
    system = _TASK_PROMPTS.get(t)
    if not system:
        return {"ok": False, "error": "invalid_task"}

    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": ctx},
            ],
            temperature=0.4,
            api_key=api_key,
            timeout_sec=120,
            max_tokens=4096,
        )
        text = (out or "").strip()
    except Exception as exc:
        logger.warning("note_studio %s failed: %s", t, exc)
        return {"ok": False, "error": str(exc)[:200]}

    result: dict[str, Any] = {"ok": True, "task": t, "markdown": text}
    if t == "timeline":
        try:
            m = re.search(r"\[[\s\S]*\]", text)
            if m:
                result["timeline"] = json.loads(m.group(0))
        except Exception:
            result["timeline"] = []
            result["parseWarning"] = "timeline_json_parse_failed"
    if t in ("flashcards", "mindmap"):
        try:
            m = re.search(r"[\[{][\s\S]*[\]}]", text)
            if m:
                result[t] = json.loads(m.group(0))
        except Exception:
            result[t] = []
            result["parseWarning"] = f"{t}_json_parse_failed"

    if persist:
        aid = str(uuid.uuid4())
        artifact = {
            "id": aid,
            "task": t,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "markdown": text,
        }
        if result.get("timeline"):
            artifact["timeline"] = result["timeline"]
        if result.get("flashcards"):
            artifact["flashcards"] = result["flashcards"]
        if result.get("mindmap"):
            artifact["mindmap"] = result["mindmap"]
        _append_artifact(note_id, artifact)
        result["artifactId"] = aid

    return result


def run_notebook_studio(
    notebook: str,
    note_ids: list[str],
    task: str,
    *,
    user_ref: str | None,
    api_key: str | None = None,
) -> dict[str, Any]:
    capped = note_ids[:notebook_studio_max_notes()]
    ctx, _fps = build_notebook_digest_context(notebook, capped, user_ref=user_ref)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries"}
    t = (task or "").strip().lower()
    if t not in ("outline", "brief", "faq"):
        return {"ok": False, "error": "invalid_task", "hint": "笔记本级仅支持 outline/brief/faq"}
    system = _TASK_PROMPTS[t]
    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system + " 这是同一笔记本下多篇资料的摘要。"},
                {"role": "user", "content": ctx},
            ],
            temperature=0.4,
            api_key=api_key,
            timeout_sec=120,
            max_tokens=4096,
        )
        text = (out or "").strip()
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:200]}
    return {"ok": True, "task": t, "markdown": text, "notebook": notebook, "noteCount": len(capped)}
