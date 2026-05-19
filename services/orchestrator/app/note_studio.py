"""
资料 Studio：基于 L0 + 片摘要生成大纲 / 测验 / 时间线（不重扫全文）。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .models import get_note_by_id
from .note_shards import list_shards
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_OUTLINE_SYS = (
    "你是学习助手。根据全书概览与各部分摘要，输出 Markdown 章节大纲（层级标题 + 每节 1～2 句要点）。"
    "只使用给定摘要中的信息，不要编造。"
)
_QUIZ_SYS = (
    "你是教师。根据给定部分摘要，出 5 道测验题（混合选择/简答），附简短参考答案并标明对应「部分」标题。"
    "不要编造摘要中没有的事实。"
)
_TIMELINE_SYS = (
    "你是编辑。从各部分摘要中提取带日期或时间顺序的事件，输出 JSON 数组："
    '[{"date":"...","event":"...","partTitle":"..."}]，最多 20 条。无日期则按逻辑顺序。只输出 JSON。'
)


def _metadata_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


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


def run_note_studio(
    note_id: str,
    task: str,
    *,
    user_ref: str | None,
    shard_ids: list[str] | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """task: outline | quiz | timeline"""
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return {"ok": False, "error": "note_not_found"}
    ctx = _context_from_note(row, shard_ids=shard_ids)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries", "hint": "请先完成资料索引与片摘要"}

    t = (task or "").strip().lower()
    if t == "outline":
        system = _OUTLINE_SYS
    elif t == "quiz":
        system = _QUIZ_SYS
    elif t == "timeline":
        system = _TIMELINE_SYS
    else:
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
    return result
