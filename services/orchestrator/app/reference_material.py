"""
多来源参考材料合并 + 长文压缩（P2 / P2+）。
P2+：reference_rag_mode = keyword | full_coverage | hybrid（见 rag_core：关键词 + 可选向量混合）。
任务 meta['rag_pipeline'] 汇总模式、混合检索、笔记向量检索可观测字段（retrieve_obs_notes）。
多笔记脚本参考：build_layered_reference_block 的摘要/检索预算与 top_k 随勾选条数略增（SCRIPT_LAYERED_TOP_K）。
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from .legacy_bridge import parse_url_content
from .models import get_note_by_id
from .note_document_extract import extract_text_from_bytes
from .object_store import get_object_bytes

logger = logging.getLogger(__name__)


def _script_layered_top_k() -> int:
    try:
        return max(64, min(200, int(os.getenv("SCRIPT_LAYERED_TOP_K", "112") or "112")))
    except (TypeError, ValueError):
        return 112


def _layered_reference_budgets(note_count: int, rag_cap_early: int) -> tuple[int, int, int]:
    """
    脚本合并参考：摘要预算、检索预算、向量 Top-K。
    勾选条数增多时略增检索预算与 top_k，减轻「只打到少数几本」的块分布。
    """
    nc = max(1, min(int(note_count or 1), 24))
    top_k = _script_layered_top_k()
    summary_budget = min(28_000, max(10_000, rag_cap_early // 2 + nc * 250))
    retrieval_budget = min(140_000, max(32_000, int(rag_cap_early * 1.85) + nc * 2200))
    return summary_budget, retrieval_budget, top_k


def _choose_auto_rag_top_k(total_chars: int) -> int:
    n = int(total_chars or 0)
    if n < 20_000:
        return 8
    if n < 50_000:
        return 12
    if n < 100_000:
        return 16
    return 20


def _note_file_bytes_to_text(data: bytes, ext: str) -> str:
    """与上传解析共用 note_document_extract。"""
    try:
        return extract_text_from_bytes(data, ext).text
    except Exception as exc:
        logger.warning("note_file extract (%s): %s", ext, exc)
        return ""


def load_note_text_for_script(note_id: str, user_ref: str | None = None) -> tuple[str, str]:
    """返回 (正文, 标题或 id)。"""
    row = get_note_by_id((note_id or "").strip(), user_ref=user_ref)
    if not row:
        return "", note_id
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    title = str(md.get("title") or note_id)
    it = str(row.get("input_type") or "")
    if it == "note_text":
        return str(row.get("content_text") or "").strip(), title
    if it == "note_file":
        key = row.get("file_object_key")
        ext = str(md.get("ext") or "txt").lower()
        if not key:
            return "", title
        try:
            raw = get_object_bytes(str(key))
        except Exception as exc:
            logger.warning("get_object_bytes %s: %s", key, exc)
            return "", title
        txt = _note_file_bytes_to_text(raw, ext)
        return txt.strip(), title
    return "", title


def compress_long_reference(text: str, max_chars: int) -> str:
    """长参考朴素压缩：头 + 中 + 尾（非向量检索）。"""
    if len(text) <= max_chars:
        return text
    head = max_chars // 3
    tail = max_chars // 3
    mid = max(0, max_chars - head - tail - 120)
    mid_start = max(0, len(text) // 2 - mid // 2)
    return (
        text[:head]
        + "\n\n【…中间省略长参考材料…】\n\n"
        + text[mid_start : mid_start + mid]
        + "\n\n【…】\n\n"
        + text[-tail:]
    )


# 与 legacy 侧 RAG_TRIGGER_CHARS 对齐：低于此长度不跑向量混合（改走 keyword 等）
RAG_HYBRID_TRIGGER_CHARS = 12_000


def _finalize_rag_pipeline_meta(meta: dict[str, Any]) -> None:
    """汇总参考材料 RAG 链路可观测字段，写入 meta['rag_pipeline']。"""
    layered = meta.get("notes_layered_rag_meta")
    layered_dict = layered if isinstance(layered, dict) else {}
    meta["rag_pipeline"] = {
        "reference_rag_mode": meta.get("reference_rag_mode"),
        "rag_max_chars": meta.get("rag_max_chars"),
        "rag_hybrid": meta.get("rag_hybrid"),
        "rag_hybrid_skipped": meta.get("rag_hybrid_skipped"),
        "rag_hybrid_log": (meta.get("rag_hybrid_log") or "")[:400] if meta.get("rag_hybrid_log") else None,
        "rag_hybrid_error": meta.get("rag_hybrid_error"),
        "rag_embedding_backend": meta.get("rag_embedding_backend"),
        "rag_keyword": meta.get("rag_keyword"),
        "rag_full_coverage": meta.get("rag_full_coverage"),
        "rag_compressed": meta.get("rag_compressed"),
        "rag_final_trim": meta.get("rag_final_trim"),
        "hard_truncated": meta.get("hard_truncated"),
        "rag_chunks_total": meta.get("rag_chunks_total"),
        "rag_chunks_selected": meta.get("rag_chunks_selected"),
        "notes_layered_rag": bool(layered_dict),
        "retrieve_obs_notes": layered_dict.get("retrieve_obs"),
    }


def merge_reference_for_script(
    payload: dict[str, Any],
    source_text: str,
    source_url: str,
    api_key: str | None = None,
    *,
    max_note_refs: int | None = None,
    user_ref: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """
    合并用户输入、主 URL、多 URL、选中笔记、附加参考段落；可选长文压缩。
    reference_rag_mode=hybrid 且合并后足够长时走向量 + 关键词混合（EmbeddingProvider / RAG_EMBEDDING_*）。
    """
    note_cap = max_note_refs if max_note_refs is not None and max_note_refs > 0 else 24

    raw_cap_early = payload.get("rag_max_chars")
    try:
        rag_cap_early = int(raw_cap_early) if raw_cap_early is not None else 20_000
    except (TypeError, ValueError):
        rag_cap_early = 20_000
    rag_cap_early = max(8_000, min(120_000, rag_cap_early))

    meta: dict[str, Any] = {
        "notes_loaded": 0,
        "reference_snippets": 0,
        "extra_urls": 0,
        "rag_compressed": False,
        "max_note_refs": note_cap,
    }
    parts: list[str] = []

    base = (source_text or "").strip()
    if base:
        parts.append(base)

    u0 = (source_url or "").strip()
    if u0:
        p = parse_url_content(u0)
        if p:
            parts.append(f"【参考网页】\n{p.strip()}")

    raw_list = payload.get("url_list")
    if isinstance(raw_list, list):
        # 最多 8 条：减少串行拉取与解析（可显式合并材料）
        for u in raw_list[:8]:
            if not isinstance(u, str):
                continue
            u = u.strip()
            if not u:
                continue
            p = parse_url_content(u)
            if p:
                parts.append(f"【参考网页】\n{p.strip()}")
                meta["extra_urls"] += 1

    note_ids = payload.get("selected_note_ids")
    if isinstance(note_ids, list):
        if len(note_ids) > note_cap:
            meta["note_ids_truncated"] = len(note_ids) - note_cap
        capped_raw = note_ids[:note_cap]
        capped_nids = [str(n).strip() for n in capped_raw if isinstance(n, str) and str(n).strip()]

        from .note_rag_service import NOTE_LAYERED_RAG, build_layered_reference_block, count_rag_chunks_for_notes
        from .rag_core import build_retrieval_query

        layered_block: str | None = None
        if (
            NOTE_LAYERED_RAG
            and capped_nids
            and not bool(payload.get("notes_reference_full_text"))
            and count_rag_chunks_for_notes(capped_nids) > 0
        ):
            topic_text = str(payload.get("text") or "").strip()
            qh = build_retrieval_query(
                topic_text[:2000] if topic_text else "",
                str(payload.get("script_style") or ""),
                str(payload.get("script_language") or "中文"),
                str(payload.get("program_name") or ""),
                str(payload.get("speaker1_persona") or ""),
                str(payload.get("speaker2_persona") or ""),
                str(payload.get("script_constraints") or ""),
            ) or (topic_text[:1200] if topic_text else "资料要点")
            sb, rb, tk = _layered_reference_budgets(len(capped_nids), rag_cap_early)
            lb, lmeta = build_layered_reference_block(
                note_ids=capped_nids,
                query_hint=qh,
                user_ref=user_ref,
                summary_budget=sb,
                retrieval_budget=rb,
                top_k=tk,
            )
            meta["notes_layered_rag_meta"] = lmeta
            layered_block = lb

        if layered_block:
            parts.append("【勾选笔记·摘要与向量检索】\n" + layered_block)
            meta["notes_loaded"] = len(capped_nids)
        else:
            for nid in capped_raw:
                if not isinstance(nid, str) or not nid.strip():
                    continue
                body, title = load_note_text_for_script(nid.strip(), user_ref=user_ref)
                if body:
                    parts.append(f"【笔记：{title}】\n{body}")
                    meta["notes_loaded"] += 1

    ref_texts = payload.get("reference_texts")
    if isinstance(ref_texts, list):
        for i, t in enumerate(ref_texts[:16]):
            if not isinstance(t, str) or not t.strip():
                continue
            parts.append(f"【附加参考 {i + 1}】\n{t.strip()}")
            meta["reference_snippets"] += 1

    merged = "\n\n".join(parts).strip()
    if not merged:
        merged = (base or "请介绍 AI Native 应用架构").strip()

    hard_max = 400_000
    if len(merged) > hard_max:
        merged = merged[:hard_max] + "\n\n【…参考材料过长已硬截断…】"
        meta["hard_truncated"] = True

    use_rag = payload.get("use_rag")
    if use_rag is None:
        use_compress = True
    else:
        use_compress = bool(use_rag)

    rag_cap = rag_cap_early
    meta["rag_max_chars"] = rag_cap

    mode = str(payload.get("reference_rag_mode") or "truncate").strip().lower()
    if mode not in ("truncate", "keyword", "full_coverage", "hybrid"):
        mode = "truncate"
    meta["reference_rag_mode"] = mode

    if not use_compress:
        _finalize_rag_pipeline_meta(meta)
        return merged, meta

    if mode == "hybrid" and len(merged) >= RAG_HYBRID_TRIGGER_CHARS:
        try:
            from .rag_core import apply_hybrid_vector_rag

            merged, log_msg = apply_hybrid_vector_rag(merged, payload, api_key)
            meta["rag_hybrid"] = True
            if log_msg:
                meta["rag_hybrid_log"] = str(log_msg)[:800]
            try:
                from app.fyv_shared.embedding_provider import EmbeddingProvider

                meta["rag_embedding_backend"] = EmbeddingProvider().active_backend()
            except Exception:
                pass
        except Exception as exc:
            logger.warning("hybrid vector RAG: %s", exc)
            meta["rag_hybrid_error"] = str(exc)[:400]
            if len(merged) > rag_cap:
                merged = compress_long_reference(merged, rag_cap)
                meta["rag_compressed"] = True
        if len(merged) > rag_cap:
            merged = merged[:rag_cap] + "\n【…截断…】"
            meta["rag_final_trim"] = True
        _finalize_rag_pipeline_meta(meta)
        return merged, meta

    if len(merged) <= rag_cap:
        _finalize_rag_pipeline_meta(meta)
        return merged, meta

    rest_mode = mode
    if mode == "hybrid":
        meta["rag_hybrid_skipped"] = f"below_{RAG_HYBRID_TRIGGER_CHARS}_chars_fallback_keyword"
        rest_mode = "keyword"

    if rest_mode == "truncate":
        merged = compress_long_reference(merged, rag_cap)
        meta["rag_compressed"] = True
        _finalize_rag_pipeline_meta(meta)
        return merged, meta

    topic_hint = str(payload.get("text") or merged[:1200])[:1200]
    try:
        from .rag_core import build_retrieval_query

        query = build_retrieval_query(
            topic_hint,
            str(payload.get("script_style") or ""),
            str(payload.get("script_language") or "中文"),
            str(payload.get("program_name") or ""),
            str(payload.get("speaker1_persona") or ""),
            str(payload.get("speaker2_persona") or ""),
            str(payload.get("script_constraints") or ""),
        )
    except Exception as exc:
        logger.warning("build_retrieval_query failed: %s", exc)
        merged = compress_long_reference(merged, rag_cap)
        meta["rag_compressed"] = True
        _finalize_rag_pipeline_meta(meta)
        return merged, meta

    if rest_mode == "keyword":
        try:
            from .rag_core import retrieve_top_chunks

            top_k = _choose_auto_rag_top_k(len(merged))
            top_chunks, chunk_count = retrieve_top_chunks(merged, query, top_k=top_k)
            if top_chunks:
                selected = [
                    f"【检索片段 {c['chunk_index']} | score={c['score']:.3f}】\n{c['content']}" for c in top_chunks
                ]
                merged = "\n\n".join(selected)
                meta["rag_keyword"] = True
                meta["rag_chunks_total"] = chunk_count
                meta["rag_chunks_selected"] = len(top_chunks)
            else:
                merged = compress_long_reference(merged, rag_cap)
                meta["rag_compressed"] = True
        except Exception as exc:
            logger.warning("keyword RAG: %s", exc)
            merged = compress_long_reference(merged, rag_cap)
            meta["rag_compressed"] = True
    elif rest_mode == "full_coverage":
        try:
            from .rag_core import build_full_coverage_context

            phase1, chunk_count = build_full_coverage_context(merged, query, max_total_chars=min(rag_cap, 24_000))
            if phase1:
                merged = phase1
                meta["rag_full_coverage"] = True
                meta["rag_chunks_total"] = chunk_count
            else:
                merged = compress_long_reference(merged, rag_cap)
                meta["rag_compressed"] = True
        except Exception as exc:
            logger.warning("full_coverage RAG: %s", exc)
            merged = compress_long_reference(merged, rag_cap)
            meta["rag_compressed"] = True

    if len(merged) > rag_cap:
        merged = merged[:rag_cap] + "\n【…截断…】"
        meta["rag_final_trim"] = True

    _finalize_rag_pipeline_meta(meta)
    return merged, meta


def effective_article_script_target_chars(
    requested: int,
    *,
    merged_chars: int,
    notes_loaded: int,
    tier_cap: int,
) -> int:
    """
    按合并后参考材料规模与勾选笔记数，收敛「笔记文章」目标字数，避免薄材料硬写超长稿。

    材料与条数足够时不压降，保留套餐上限内用户所选目标（如 Max 档 5 万字）。
    """
    try:
        req = max(200, min(int(tier_cap), int(requested)))
    except (TypeError, ValueError):
        return max(200, min(int(tier_cap), 2000))
    mc = max(0, int(merged_chars))
    nl = max(0, int(notes_loaded))
    if mc < 3500 and nl <= 1:
        # 极薄材料：短目标仍用紧上限；用户显式要万字级以上时不应压到 ~mc*3+2k（易与「要 2 万字」预期严重不符）
        tight = max(2500, min(12_000, mc * 3 + 2000))
        if req <= 8000:
            return min(req, tight)
        relaxed = max(10_000, min(req, mc * 7 + 5000))
        return min(req, max(tight, relaxed))
    if req >= 12_000 and mc < 6000:
        return min(req, max(8000, min(req, int(mc * 1.7) + 5000)))
    if req >= 28_000 and mc < 16_000:
        return min(req, max(16_000, min(req, int(mc * 1.25) + 8000)))
    if req >= 42_000 and not (mc >= 22_000 or nl >= 5):
        return min(req, max(24_000, min(req, int(mc * 1.15) + 10_000)))
    return req
