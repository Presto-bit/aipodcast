"""个人特色 IP（v6）：笔记本素材枚举与学习蒸馏。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .author_ip_distill import material_in_style_learning, run_author_ip_distill
from .author_ip_distill_inputs import build_distill_excerpt, note_content_fingerprint
from .author_ip_store import get_author_ip
from .db import get_conn, get_cursor
from .models import list_notes
from .models._core import _resolve_user_uuid_or_none
from .note_rag_service import sample_rag_chunk_texts_for_notes
from .note_style_features import format_style_features_block, parse_style_features, style_features_match_hash

_MATURITY_RANK = {"empty": 0, "sketch": 1, "sketch_plus": 2, "ready": 3, "stale": 2}


def _md_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def list_ip_materials(user_ref: str | None, ip_item: dict[str, Any]) -> list[dict[str, Any]]:
    nb = str(ip_item.get("notebookName") or "").strip()
    if not nb:
        return []
    rows = list_notes(user_ref=user_ref, notebook=nb, limit=200, offset=0)
    note_ids = [str(row.get("id") or "").strip() for row in rows or [] if str(row.get("id") or "").strip()]
    chunk_map = sample_rag_chunk_texts_for_notes(note_ids, per_note=3)
    out: list[dict[str, Any]] = []
    for row in rows or []:
        md = _md_dict(row)
        body = str(row.get("content_text") or "").strip()
        include_learn = md.get("includeInStyleLearning")
        include_flag = include_learn is not False
        updated_raw = row.get("updated_at") or row.get("created_at")
        updated_at = updated_raw.isoformat() if hasattr(updated_raw, "isoformat") else str(updated_raw or "")
        note_id = str(row.get("id") or "")
        rag_hash = str(row.get("note_rag_body_hash") or "").strip()
        note_summary = str(row.get("note_summary") or "").strip()
        pre_summary = str(md.get("preprocessSummary") or "").strip()
        rag_chunks = int(row.get("rag_chunk_count") or 0)
        cached_sf = parse_style_features(md)
        if style_features_match_hash(cached_sf, rag_hash):
            distill_body = format_style_features_block(cached_sf, title=str(md.get("title") or "未命名"))
            distill_kind = "cached_features"
        else:
            distill_body, distill_kind = build_distill_excerpt(
                body=body,
                note_summary=note_summary,
                preprocess_summary=pre_summary,
                rag_chunk_texts=chunk_map.get(note_id) or [],
            )
        fingerprint = note_content_fingerprint(body, rag_hash)
        out.append(
            {
                "noteId": note_id,
                "title": str(md.get("title") or "未命名").strip()[:200],
                "body": body,
                "distillBody": distill_body,
                "distillSourceKind": distill_kind,
                "noteSummary": note_summary,
                "preprocessSummary": pre_summary,
                "ragChunkCount": rag_chunks,
                "noteRagBodyHash": rag_hash,
                "materialType": str(md.get("authorMaterialType") or "published").strip(),
                "experienceTemplateId": str(md.get("experienceTemplateId") or "").strip(),
                "includeInStyleLearning": include_flag,
                "updatedAt": updated_at,
                "contentVersion": fingerprint,
                "styleFeatures": cached_sf if style_features_match_hash(cached_sf, rag_hash) else None,
            }
        )
    return out


def _guard_writable(ip_item: dict[str, Any] | None) -> tuple[dict[str, Any], str | None]:
    if not ip_item:
        return {}, "IP 不存在"
    if bool(ip_item.get("isReadOnly")):
        return ip_item, "示例 IP 为只读，请复制后编辑"
    return ip_item, None


def _compute_maturity(profile: dict[str, Any], materials: list[dict[str, Any]]) -> str:
    cs = profile.get("coldStart")
    base = 1 if isinstance(cs, dict) and cs.get("completedAt") else 0
    exp = sum(1 for m in materials if m.get("materialType") == "experience_card")
    pub = sum(1 for m in materials if m.get("materialType") in ("published", "draft"))
    traits = len(profile.get("traits") or [])
    if exp == 0 and pub == 0 and base == 0:
        return "empty"
    if pub >= 1 and traits >= 3:
        return "ready"
    if pub >= 1 or (exp >= 2 and traits >= 2):
        return "sketch_plus"
    if exp >= 1 or base >= 1:
        return "sketch"
    return "empty"


def refresh_author_ip_maturity(user_ref: str | None, ip_id: str) -> dict[str, Any] | None:
    ip_item = get_author_ip(user_ref, ip_id)
    if not ip_item:
        return None
    if bool(ip_item.get("isTemplate")):
        return ip_item
    materials = list_ip_materials(user_ref, ip_item)
    profile = ip_item.get("profile") if isinstance(ip_item.get("profile"), dict) else {}
    new_m = _compute_maturity(profile, materials)
    old_m = str(ip_item.get("maturity") or "empty")
    if _MATURITY_RANK.get(new_m, 0) < _MATURITY_RANK.get(old_m, 0) and old_m == "ready":
        new_m = old_m
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return ip_item
            cur.execute(
                """
                UPDATE author_ips SET maturity = %s, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                """,
                (new_m, user_uuid, ip_id),
            )
            conn.commit()
    return get_author_ip(user_ref, ip_id)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_style_snapshot(learning_materials: list[dict[str, Any]]) -> dict[str, Any]:
    note_ids: list[str] = []
    note_versions: dict[str, str] = {}
    for m in learning_materials:
        nid = str(m.get("noteId") or "").strip()
        if not nid:
            continue
        note_ids.append(nid)
        ver = str(m.get("noteRagBodyHash") or "").strip()
        if not ver:
            ver = str(m.get("contentVersion") or "").strip()
        if not ver:
            ver = str(m.get("updatedAt") or "")[:40]
        note_versions[nid] = ver or "0"
    return {
        "noteIds": note_ids,
        "noteVersions": note_versions,
        "versionScheme": "note_rag_body_hash",
        "learnedAt": _now_iso(),
    }


def learn_author_ip(
    user_ref: str | None,
    ip_id: str,
    *,
    mode: str = "full",
    note_ids: list[str] | None = None,
) -> dict[str, Any]:
    """从参与学习的素材蒸馏词云、特色、场景与生命力摘要。可选 note_ids 限定笔记本勾选范围。"""
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    materials = list_ip_materials(user_ref, ip_item)
    scoped_by_selection = note_ids is not None
    if scoped_by_selection:
        allowed = {str(x).strip() for x in note_ids if str(x).strip()}
        if not allowed:
            raise ValueError("note_ids_required")
        materials = [m for m in materials if str(m.get("noteId") or "") in allowed]
    if scoped_by_selection:
        learning = list(materials)
    else:
        learning = [m for m in materials if material_in_style_learning(m)]
    if not learning:
        raise ValueError("no_learning_materials")
    profile = ip_item.get("profile") if isinstance(ip_item.get("profile"), dict) else {}
    learn_mode = "lite" if str(mode or "").strip().lower() == "lite" else "full"
    profile = run_author_ip_distill(
        profile,
        learning,
        one_liner=str(ip_item.get("oneLiner") or ""),
        mode=learn_mode,
        fresh_traits=scoped_by_selection,
    )
    profile["styleSnapshot"] = _build_style_snapshot(learning)
    profile["styleSyncStatus"] = "ready"
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            cur.execute(
                """
                UPDATE author_ips SET profile_json = %s::jsonb, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                """,
                (json.dumps(profile, ensure_ascii=False), user_uuid, ip_id),
            )
            conn.commit()
    updated = refresh_author_ip_maturity(user_ref, ip_id)
    if not updated:
        raise ValueError("ip_not_found")
    return updated
