"""单条笔记风格特征（P2）：RAG 索引后异步提取，learn 时聚合而不再灌全文。"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from .author_ip_distill_inputs import build_distill_excerpt
from .models import get_note_by_id

logger = logging.getLogger(__name__)

STYLE_FEATURES_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _md_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def style_features_enabled() -> bool:
    return str(os.getenv("NOTE_STYLE_FEATURES", "1")).strip().lower() not in ("0", "false", "no", "off")


def learn_merge_features_enabled() -> bool:
    return str(os.getenv("AUTHOR_IP_LEARN_MERGE_FEATURES", "1")).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def parse_style_features(md: dict[str, Any] | None) -> dict[str, Any] | None:
    raw = (md or {}).get("styleFeatures")
    if not isinstance(raw, dict):
        return None
    if int(raw.get("version") or 0) != STYLE_FEATURES_VERSION:
        return None
    if not str(raw.get("sourceHash") or "").strip():
        return None
    return raw


def style_features_match_hash(features: dict[str, Any] | None, body_hash: str) -> bool:
    if not features:
        return False
    return str(features.get("sourceHash") or "").strip() == str(body_hash or "").strip()


def _token_hints(text: str, *, limit: int = 8) -> list[str]:
    pat = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,6}")
    stop = {"我们", "你们", "他们", "这个", "那个", "以及", "如果", "但是", "因为", "所以", "可以", "已经"}
    freq: dict[str, int] = {}
    for m in pat.finditer((text or "")[:6000]):
        tok = m.group(0).strip().lower()
        if not tok or tok in stop:
            continue
        freq[tok] = freq.get(tok, 0) + 1
    return [k for k, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def build_heuristic_style_features(
    *,
    title: str,
    source_hash: str,
    note_summary: str = "",
    preprocess_summary: str = "",
    preprocess_tags: list[str] | None = None,
    chunk_texts: list[str] | None = None,
) -> dict[str, Any]:
    summary = (note_summary or preprocess_summary or "").strip()
    chunks = [str(c).strip() for c in (chunk_texts or []) if str(c).strip()]
    snippet_parts: list[str] = []
    if summary:
        snippet_parts.append(summary[:420])
    elif chunks:
        snippet_parts.append(chunks[0][:360])
    style_snippet = "\n".join(snippet_parts)[:480].strip()
    tag_hints = list(dict.fromkeys([*(preprocess_tags or []), *_token_hints(style_snippet)]))[:10]
    tone_hints = tag_hints[:5]
    return {
        "version": STYLE_FEATURES_VERSION,
        "sourceHash": source_hash,
        "extractedAt": _now_iso(),
        "styleSnippet": style_snippet,
        "toneHints": tone_hints,
        "tagHints": tag_hints,
        "extractKind": "heuristic",
    }


def format_style_features_block(features: dict[str, Any], *, title: str = "") -> str:
    lines: list[str] = []
    if title.strip():
        lines.append(f"【资料】{title.strip()[:120]}")
    sn = str(features.get("styleSnippet") or "").strip()
    if sn:
        lines.append(f"【风格提要】{sn[:500]}")
    tones = features.get("toneHints") if isinstance(features.get("toneHints"), list) else []
    if tones:
        lines.append(f"【口吻】{'、'.join(str(t) for t in tones[:6])}")
    tags = features.get("tagHints") if isinstance(features.get("tagHints"), list) else []
    if tags:
        lines.append(f"【关键词】{'、'.join(str(t) for t in tags[:8])}")
    return "\n".join(lines).strip()


def extract_note_style_features(
    note_id: str,
    user_ref: str | None,
    *,
    api_key: str | None = None,
) -> dict[str, Any] | None:
    """读取笔记与 RAG 产物，生成 styleFeatures（不写库）。"""
    if not style_features_enabled():
        return None
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return None
    body = str(row.get("content_text") or "").strip()
    source_hash = str(row.get("note_rag_body_hash") or "").strip()
    if not source_hash:
        return None
    md = _md_dict(row)
    title = str(md.get("title") or "未命名").strip()
    note_summary = str(row.get("note_summary") or "").strip()
    pre_summary = str(md.get("preprocessSummary") or "").strip()
    pre_tags = md.get("preprocessTags") if isinstance(md.get("preprocessTags"), list) else []
    from .note_rag_service import sample_rag_chunk_texts_for_notes

    chunks = sample_rag_chunk_texts_for_notes([note_id], per_note=2).get(note_id) or []

    features = build_heuristic_style_features(
        title=title,
        source_hash=source_hash,
        note_summary=note_summary,
        preprocess_summary=pre_summary,
        preprocess_tags=[str(x) for x in pre_tags if str(x).strip()],
        chunk_texts=chunks,
    )

    if str(os.getenv("NOTE_STYLE_FEATURES_LLM", "0")).strip().lower() in ("1", "true", "yes", "on"):
        try:
            from .author_ip_distill_llm import enrich_style_features_with_llm

            features = enrich_style_features_with_llm(
                features,
                title=title,
                excerpt=build_distill_excerpt(
                    body=body,
                    note_summary=note_summary,
                    preprocess_summary=pre_summary,
                    rag_chunk_texts=chunks,
                )[0][:2800],
                api_key=api_key,
            )
        except Exception as exc:
            logger.warning("note_style_features llm enrich failed note_id=%s: %s", note_id, exc)

    return features


def persist_note_style_features(note_id: str, features: dict[str, Any]) -> None:
    from .note_rag_service import _merge_note_rag_index_metadata

    _merge_note_rag_index_metadata(note_id, {"styleFeatures": features})


def extract_and_persist_note_style_features(
    note_id: str,
    user_ref: str | None,
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    features = extract_note_style_features(note_id, user_ref, api_key=api_key)
    if not features:
        return {"ok": False, "error": "no_features"}
    persist_note_style_features(note_id, features)
    return {"ok": True, "extractKind": features.get("extractKind"), "sourceHash": features.get("sourceHash")}


def try_enqueue_note_style_features(note_id: str, user_ref: str | None) -> str | None:
    """入队异步任务；返回 job_id 或 None。"""
    if not style_features_enabled():
        return None
    nid = str(note_id or "").strip()
    if not nid:
        return None
    row = get_note_by_id(nid, user_ref=user_ref)
    if row:
        rag_hash = str(row.get("note_rag_body_hash") or "").strip()
        cached = parse_style_features(_md_dict(row))
        if rag_hash and style_features_match_hash(cached, rag_hash):
            return None
    try:
        from .models import NOTES_PODCAST_STUDIO_PROJECT, create_job, ensure_default_project
        from .queues import ai_queue
        from .worker_tasks import run_ai_job

        pid = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
        jid = create_job(pid, "note_style_features", "ai", {"note_id": nid}, user_ref)
        ai_queue.enqueue(run_ai_job, jid, job_timeout="8m")
        return jid
    except Exception as exc:
        logger.warning("note_style_features enqueue failed note_id=%s: %s", nid, exc)
        return None


def learning_materials_with_fresh_features(
    materials: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    """全部参与学习的素材均有与 body_hash 一致的 styleFeatures 时返回列表，否则 None。"""
    from .author_ip_distill import _learning_materials

    learning = _learning_materials(materials)
    if not learning:
        return None
    for m in learning:
        sf = m.get("styleFeatures")
        if not isinstance(sf, dict):
            return None
        if not style_features_match_hash(sf, str(m.get("noteRagBodyHash") or "")):
            return None
    return learning
