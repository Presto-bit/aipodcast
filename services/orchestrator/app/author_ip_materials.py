"""个人特色 IP：素材、冷启动、成稿入库、学习刷新。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from psycopg2.extras import Json

from .author_ip_distill import material_in_style_learning, run_author_ip_distill
from .author_ip_store import get_author_ip, is_author_ip_notebook_name
from .author_ip_style import list_ip_materials
from .db import get_conn, get_cursor
from .models import NOTES_PODCAST_STUDIO_PROJECT, create_text_note, delete_note, ensure_default_project
from .models._core import _resolve_user_uuid_or_none

_MATURITY_RANK = {"empty": 0, "sketch": 1, "sketch_plus": 2, "ready": 3, "stale": 2}


def _guard_writable(ip_item: dict[str, Any] | None) -> tuple[dict[str, Any], str | None]:
    if not ip_item:
        return {}, "IP 不存在"
    if bool(ip_item.get("isReadOnly")):
        return ip_item, "示例 IP 为只读，请复制后编辑"
    return ip_item, None


def _load_profile_row(cur: Any, user_uuid: str, ip_id: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT profile_json, maturity, one_liner, is_read_only
        FROM author_ips
        WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
        """,
        (user_uuid, ip_id),
    )
    row = cur.fetchone()
    if not row:
        return None
    prof = row.get("profile_json") or {}
    if isinstance(prof, str):
        try:
            prof = json.loads(prof)
        except Exception:
            prof = {}
    if not isinstance(prof, dict):
        prof = {}
    return {
        "profile": prof,
        "maturity": str(row.get("maturity") or "empty"),
        "oneLiner": str(row.get("one_liner") or ""),
        "isReadOnly": bool(row.get("is_read_only")),
    }


def list_author_ip_materials(user_ref: str | None, ip_id: str) -> list[dict[str, Any]]:
    ip_item = get_author_ip(user_ref, ip_id)
    if not ip_item:
        raise ValueError("ip_not_found")
    items = list_ip_materials(user_ref, ip_item)
    for m in items:
        m["authorIpId"] = ip_id
        preview = str(m.get("body") or "")[:240]
        m["preview"] = preview
        m["bodyLength"] = len(str(m.get("body") or ""))
        if m.get("includeInStyleLearning") is False:
            m["includeInStyleLearning"] = False
        else:
            m["includeInStyleLearning"] = True
    return items


def add_author_ip_material(
    user_ref: str | None,
    ip_id: str,
    *,
    title: str,
    body: str,
    material_type: str = "experience_card",
    experience_template_id: str = "",
) -> dict[str, Any]:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    nb = str(ip_item.get("notebookName") or "").strip()
    if not nb:
        raise ValueError("notebook_missing")
    content = str(body or "").strip()
    if not content:
        raise ValueError("body_required")
    name = str(title or "未命名").strip()[:200] or "未命名"
    mtype = str(material_type or "experience_card").strip()
    if mtype not in ("experience_card", "published", "draft"):
        mtype = "experience_card"
    project_id = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
    extra: dict[str, Any] = {
        "authorIpId": ip_id,
        "authorMaterialType": mtype,
    }
    if experience_template_id:
        extra["experienceTemplateId"] = str(experience_template_id).strip()[:80]
    note_id = create_text_note(
        project_id,
        name,
        nb,
        content,
        user_ref=user_ref,
        extra_metadata=extra,
    )
    refresh_author_ip_maturity(user_ref, ip_id)
    return {
        "noteId": note_id,
        "title": name,
        "materialType": mtype,
        "authorIpId": ip_id,
    }


def delete_author_ip_material(user_ref: str | None, ip_id: str, note_id: str) -> bool:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    materials = {str(m.get("noteId") or "") for m in list_ip_materials(user_ref, ip_item)}
    if note_id not in materials:
        raise ValueError("note_not_in_ip")
    if not delete_note(note_id, user_ref=user_ref):
        raise ValueError("delete_failed")
    refresh_author_ip_maturity(user_ref, ip_id)
    return True


def submit_author_ip_cold_start(
    user_ref: str | None,
    ip_id: str,
    *,
    who_am_i: str,
    audience: str,
    one_liner: str,
    traits: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    nb = str(ip_item.get("notebookName") or "").strip()
    project_id = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
    who = str(who_am_i or "").strip()
    aud = str(audience or "").strip()
    liner = str(one_liner or "").strip()[:300]
    if not liner:
        raise ValueError("one_liner_required")
    created: list[str] = []
    already_done = False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            meta = _load_profile_row(cur, user_uuid, ip_id)
            if not meta:
                raise ValueError("ip_not_found")
            prof = meta["profile"]
            cs = prof.get("coldStart") if isinstance(prof.get("coldStart"), dict) else {}
            already_done = bool(cs.get("completedAt"))
            prof["coldStart"] = {
                "whoAmI": who[:2000],
                "audience": aud[:2000],
                "oneLiner": liner,
                "completedAt": True,
            }
            from .author_ip_distill import _merge_traits, _normalize_trait

            if traits:
                cleaned: list[dict[str, Any]] = []
                for tr in traits[:16]:
                    if not isinstance(tr, dict):
                        continue
                    n = _normalize_trait(tr)
                    if n:
                        cleaned.append(n)
                if cleaned:
                    prof["traits"] = _merge_traits([], cleaned, max_items=16)
            elif not prof.get("traits"):
                prof["traits"] = [
                    {
                        "dimension": "口吻",
                        "label": "直给、少套话",
                        "evidence": liner[:80],
                        "defaultOn": True,
                    },
                    {
                        "dimension": "结构",
                        "label": "结论前置",
                        "evidence": "",
                        "defaultOn": True,
                    },
                ]
            cur.execute(
                """
                UPDATE author_ips
                SET one_liner = %s, maturity = 'sketch', profile_json = %s::jsonb, updated_at = NOW()
                WHERE id = %s::uuid AND user_id = %s::uuid
                """,
                (liner, Json(prof), ip_id, user_uuid),
            )
            conn.commit()
    # v6：用户真实笔记本只写 profile.coldStart，不自动生成「我是谁/写给谁」经历卡 note；
    # 经历卡 note 仅保留在系统隐藏本 __author_ip:*（旧 IP 工作台兼容）。
    if not already_done and is_author_ip_notebook_name(nb):
        if who:
            nid = create_text_note(
                project_id,
                "我是谁",
                nb,
                who,
                user_ref=user_ref,
                extra_metadata={
                    "authorIpId": ip_id,
                    "authorMaterialType": "experience_card",
                    "experienceTemplateId": "who_am_i",
                },
            )
            created.append(nid)
        if aud:
            nid = create_text_note(
                project_id,
                "写给谁",
                nb,
                aud,
                user_ref=user_ref,
                extra_metadata={
                    "authorIpId": ip_id,
                    "authorMaterialType": "experience_card",
                    "experienceTemplateId": "audience",
                },
            )
            created.append(nid)
    item = get_author_ip(user_ref, ip_id)
    if not item:
        raise ValueError("ip_not_found")
    return {"item": item, "createdNoteIds": created}


def save_compose_to_ip_material(
    user_ref: str | None,
    ip_id: str,
    *,
    draft_body: str,
    title: str | None = None,
    topic: str | None = None,
    save_as_published: bool = True,
) -> dict[str, Any]:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    body = str(draft_body or "").strip()
    if not body:
        raise ValueError("body_required")
    nb = str(ip_item.get("notebookName") or "").strip()
    name = str(title or topic or "成稿").strip()[:200] or "成稿"
    mtype = "published" if save_as_published else "draft"
    project_id = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
    note_id = create_text_note(
        project_id,
        name,
        nb,
        body,
        user_ref=user_ref,
        extra_metadata={
            "authorIpId": ip_id,
            "authorMaterialType": mtype,
            "composeSaved": True,
            "composeTopic": str(topic or "")[:500],
        },
    )
    refresh_author_ip_maturity(user_ref, ip_id)
    return {"noteId": note_id, "title": name, "materialType": mtype}


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


def patch_author_ip_domains(
    user_ref: str | None,
    ip_id: str,
    domains: list[dict[str, Any]],
) -> dict[str, Any]:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    cleaned: list[dict[str, Any]] = []
    for i, dom in enumerate(domains[:12]):
        if not isinstance(dom, dict):
            continue
        cleaned.append(
            {
                "displayName": str(dom.get("displayName") or f"场景{i + 1}").strip()[:80],
                "boundArticleTitles": [
                    str(x).strip()[:200]
                    for x in (dom.get("boundArticleTitles") or [])
                    if str(x).strip()
                ][:20],
                "boundExperienceTemplates": [
                    str(x).strip()[:80]
                    for x in (dom.get("boundExperienceTemplates") or [])
                    if str(x).strip()
                ][:20],
            }
        )
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            meta = _load_profile_row(cur, user_uuid, ip_id)
            if not meta:
                raise ValueError("ip_not_found")
            prof = meta["profile"]
            prof["domains"] = cleaned
            cur.execute(
                """
                UPDATE author_ips SET profile_json = %s::jsonb, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid
                """,
                (Json(prof), user_uuid, ip_id),
            )
            conn.commit()
    updated = get_author_ip(user_ref, ip_id)
    if not updated:
        raise ValueError("ip_not_found")
    return updated


def mark_author_ip_first_compare_shown(user_ref: str | None, ip_id: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return
            meta = _load_profile_row(cur, user_uuid, ip_id)
            if not meta:
                return
            prof = meta["profile"]
            flags = prof.get("flags") if isinstance(prof.get("flags"), dict) else {}
            flags["firstCompareShown"] = True
            prof["flags"] = flags
            cur.execute(
                """
                UPDATE author_ips SET profile_json = %s::jsonb, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid
                """,
                (Json(prof), user_uuid, ip_id),
            )
            conn.commit()


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
    # v6.1：learn 显式传入 noteIds 时以勾选为准，不再受 includeInStyleLearning 开关阻挡
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


def patch_author_ip_traits(
    user_ref: str | None,
    ip_id: str,
    traits: list[dict[str, Any]],
) -> dict[str, Any]:
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    from .author_ip_distill import _merge_traits, _normalize_trait

    cleaned: list[dict[str, Any]] = []
    for tr in traits[:16]:
        if not isinstance(tr, dict):
            continue
        n = _normalize_trait(tr)
        if n:
            cleaned.append(n)
    merged = _merge_traits([], cleaned, max_items=16)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            meta = _load_profile_row(cur, user_uuid, ip_id)
            if not meta:
                raise ValueError("ip_not_found")
            prof = meta["profile"]
            prof["traits"] = merged
            cur.execute(
                """
                UPDATE author_ips SET profile_json = %s::jsonb, updated_at = NOW()
                WHERE user_id = %s::uuid AND id = %s::uuid
                """,
                (Json(prof), user_uuid, ip_id),
            )
            conn.commit()
    updated = refresh_author_ip_maturity(user_ref, ip_id)
    if not updated:
        raise ValueError("ip_not_found")
    return updated


def patch_author_ip_material_learning(
    user_ref: str | None,
    ip_id: str,
    note_id: str,
    *,
    include_in_style_learning: bool,
) -> dict[str, Any]:
    """更新单条素材是否参与文风学习（写入 note metadata）。"""
    ip_item, err = _guard_writable(get_author_ip(user_ref, ip_id))
    if err:
        raise ValueError("read_only" if "只读" in err else "ip_not_found")
    materials = list_ip_materials(user_ref, ip_item)
    if not any(str(m.get("noteId") or "") == note_id for m in materials):
        raise ValueError("note_not_in_ip")
    flag = bool(include_in_style_learning)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            cur.execute(
                """
                UPDATE inputs i
                SET metadata = jsonb_set(
                    COALESCE(i.metadata, '{}'::jsonb),
                    '{includeInStyleLearning}',
                    to_jsonb(%s::boolean),
                    true
                )
                FROM projects p
                WHERE i.project_id = p.id
                  AND i.id = %s::uuid
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND p.user_id = %s::uuid
                """,
                (flag, note_id, user_uuid),
            )
            if cur.rowcount < 1:
                raise ValueError("note_not_found")
            conn.commit()
    return {"noteId": note_id, "includeInStyleLearning": flag}
