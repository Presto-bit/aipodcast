"""个人特色 IP：实体、绑定笔记本、系统默认隐藏本。"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from psycopg2.extras import Json

from .db import get_conn, get_cursor
from .models import create_notebook_only
from .models._core import _resolve_user_uuid_or_none

logger = logging.getLogger(__name__)

NOTEBOOK_PREFIX = "__author_ip:"
DEFAULT_IP_DISPLAY_NAME = "我的 IP"


def _notebook_for_ip(ip_id: str) -> str:
    return f"{NOTEBOOK_PREFIX}{ip_id}"


def is_author_ip_notebook_name(name: str | None) -> bool:
    return str(name or "").startswith(NOTEBOOK_PREFIX)


_author_ip_schema_ready = False


def ensure_author_ip_schema() -> None:
    global _author_ip_schema_ready
    if _author_ip_schema_ready:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS author_ips (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  display_name TEXT NOT NULL,
                  subtitle TEXT NOT NULL DEFAULT '',
                  avatar_color TEXT NOT NULL DEFAULT 'brand',
                  notebook_name TEXT NOT NULL,
                  is_default BOOLEAN NOT NULL DEFAULT FALSE,
                  is_system_seed BOOLEAN NOT NULL DEFAULT FALSE,
                  is_template BOOLEAN NOT NULL DEFAULT FALSE,
                  is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
                  template_id TEXT,
                  maturity TEXT NOT NULL DEFAULT 'empty',
                  one_liner TEXT NOT NULL DEFAULT '',
                  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                  cloned_from_ip_id UUID REFERENCES author_ips(id) ON DELETE SET NULL,
                  archived_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  UNIQUE (user_id, notebook_name)
                );
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_author_ips_user_default
                ON author_ips (user_id, is_default)
                WHERE archived_at IS NULL;
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_author_ips_user_template
                ON author_ips (user_id, is_template)
                WHERE archived_at IS NULL;
                """
            )
            conn.commit()
    _author_ip_schema_ready = True


def _row_to_item(row: dict[str, Any], *, material_count: int = 0) -> dict[str, Any]:
    profile = row.get("profile_json") or {}
    if isinstance(profile, str):
        try:
            profile = json.loads(profile)
        except Exception:
            profile = {}
    if not isinstance(profile, dict):
        profile = {}
    return {
        "id": str(row["id"]),
        "displayName": str(row.get("display_name") or ""),
        "subtitle": str(row.get("subtitle") or ""),
        "avatarColor": str(row.get("avatar_color") or "brand"),
        "notebookName": str(row.get("notebook_name") or ""),
        "isDefault": bool(row.get("is_default")),
        "isSystemSeed": bool(row.get("is_system_seed")),
        "isTemplate": bool(row.get("is_template")),
        "isReadOnly": bool(row.get("is_read_only")),
        "templateId": row.get("template_id"),
        "maturity": str(row.get("maturity") or "empty"),
        "oneLiner": str(row.get("one_liner") or ""),
        "profile": profile,
        "materialCount": material_count,
        "traitCount": len(profile.get("traits") or []),
        "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updatedAt": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _count_materials(user_ref: str | None, notebook_name: str) -> int:
    nb = (notebook_name or "").strip()
    if not nb:
        return 0
    counts = _batch_material_counts(user_ref, [nb])
    return int(counts.get(nb, 0))


def _batch_material_counts(user_ref: str | None, notebook_names: list[str]) -> dict[str, int]:
    names = list({(n or "").strip() for n in notebook_names if (n or "").strip()})
    if not names:
        return {}
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return {}
            cur.execute(
                """
                SELECT COALESCE(i.metadata->>'notebook', '') AS nb, COUNT(*)::int AS c
                FROM inputs i
                JOIN projects p ON p.id = i.project_id
                WHERE p.user_id = %s::uuid
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND COALESCE(i.metadata->>'notebook', '') = ANY(%s)
                GROUP BY nb
                """,
                (user_uuid, names),
            )
            return {str(r.get("nb") or ""): int(r.get("c") or 0) for r in cur.fetchall() or []}


def _insert_ip_row(
    cur: Any,
    *,
    user_uuid: str,
    display_name: str,
    subtitle: str,
    avatar_color: str,
    notebook_name: str,
    is_default: bool,
    is_system_seed: bool,
    is_template: bool,
    is_read_only: bool,
    template_id: str | None,
    maturity: str,
    one_liner: str,
    profile: dict[str, Any],
    cloned_from_ip_id: str | None = None,
) -> dict[str, Any]:
    ip_id = str(uuid.uuid4())
    nb = notebook_name or _notebook_for_ip(ip_id)
    cur.execute(
        """
        INSERT INTO author_ips (
          id, user_id, display_name, subtitle, avatar_color, notebook_name,
          is_default, is_system_seed, is_template, is_read_only, template_id,
          maturity, one_liner, profile_json, cloned_from_ip_id
        ) VALUES (
          %s::uuid, %s::uuid, %s, %s, %s, %s,
          %s, %s, %s, %s, %s,
          %s, %s, %s::jsonb, %s::uuid
        )
        RETURNING *
        """,
        (
            ip_id,
            user_uuid,
            display_name,
            subtitle,
            avatar_color,
            nb,
            is_default,
            is_system_seed,
            is_template,
            is_read_only,
            template_id,
            maturity,
            one_liner,
            Json(profile),
            cloned_from_ip_id,
        ),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("author_ip_insert_failed")
    return dict(row)


def _clear_default_flag(cur: Any, user_uuid: str, *, except_ip_id: str | None = None) -> None:
    if except_ip_id:
        cur.execute(
            """
            UPDATE author_ips SET is_default = FALSE, updated_at = NOW()
            WHERE user_id = %s::uuid AND id <> %s::uuid AND archived_at IS NULL
            """,
            (user_uuid, except_ip_id),
        )
    else:
        cur.execute(
            """
            UPDATE author_ips SET is_default = FALSE, updated_at = NOW()
            WHERE user_id = %s::uuid AND archived_at IS NULL
            """,
            (user_uuid,),
        )


def ensure_default_author_ip(user_ref: str | None) -> dict[str, Any] | None:
    ensure_author_ip_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return None
            cur.execute(
                """
                SELECT * FROM author_ips
                WHERE user_id = %s::uuid AND is_system_seed = TRUE AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid,),
            )
            row = cur.fetchone()
            if row:
                nb = str(row["notebook_name"])
                return _row_to_item(row, material_count=_count_materials(user_ref, nb))
            _clear_default_flag(cur, user_uuid)
            ip_row = _insert_ip_row(
                cur,
                user_uuid=user_uuid,
                display_name=DEFAULT_IP_DISPLAY_NAME,
                subtitle="",
                avatar_color="brand",
                notebook_name="",
                is_default=True,
                is_system_seed=True,
                is_template=False,
                is_read_only=False,
                template_id=None,
                maturity="empty",
                one_liner="",
                profile={},
            )
            nb = _notebook_for_ip(str(ip_row["id"]))
            cur.execute(
                "UPDATE author_ips SET notebook_name = %s, updated_at = NOW() WHERE id = %s::uuid",
                (nb, str(ip_row["id"])),
            )
            conn.commit()
            ip_row["notebook_name"] = nb
            create_notebook_only(nb, user_ref=user_ref)
            return _row_to_item(ip_row, material_count=0)


def ensure_author_ip_notebook(user_ref: str | None) -> None:
    """兼容旧调用：确保默认「我的 IP」存在。"""
    ensure_default_author_ip(user_ref)


def list_author_ips(user_ref: str | None, *, lightweight: bool = True) -> list[dict[str, Any]]:
    """lightweight=True：列表用，素材数批量 SQL。"""
    ensure_author_ip_schema()
    ensure_default_author_ip(user_ref)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return []
            cur.execute(
                """
                SELECT * FROM author_ips
                WHERE user_id = %s::uuid AND archived_at IS NULL
                ORDER BY is_template DESC, is_default DESC, is_system_seed DESC, created_at ASC
                """,
                (user_uuid,),
            )
            rows = [dict(r) for r in cur.fetchall() or []]
    notebooks = [str(r.get("notebook_name") or "") for r in rows]
    counts = _batch_material_counts(user_ref, notebooks)
    return [
        _row_to_item(row, material_count=counts.get(str(row.get("notebook_name") or ""), 0))
        for row in rows
    ]


def get_author_ip(user_ref: str | None, ip_id: str) -> dict[str, Any] | None:
    ensure_author_ip_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return None
            cur.execute(
                """
                SELECT * FROM author_ips
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid, ip_id),
            )
            row = cur.fetchone()
            if not row:
                return None
            nb = str(row.get("notebook_name") or "")
            return _row_to_item(row, material_count=_count_materials(user_ref, nb))


def get_author_ip_by_notebook(user_ref: str | None, notebook_name: str) -> dict[str, Any] | None:
    """按用户笔记本名查找绑定的 IP（不含系统隐藏本 __author_ip:*）。"""
    nb = str(notebook_name or "").strip()
    if not nb or is_author_ip_notebook_name(nb):
        return None
    ensure_author_ip_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return None
            cur.execute(
                """
                SELECT * FROM author_ips
                WHERE user_id = %s::uuid AND notebook_name = %s AND archived_at IS NULL
                  AND is_template = FALSE
                LIMIT 1
                """,
                (user_uuid, nb),
            )
            row = cur.fetchone()
            if not row:
                return None
            nb_row = str(row.get("notebook_name") or "")
            return _row_to_item(row, material_count=_count_materials(user_ref, nb_row))


def ensure_author_ip_for_notebook(user_ref: str | None, notebook_name: str) -> dict[str, Any]:
    """笔记本 1:1 IP：不存在则懒创建，notebook_name 指向真实用户笔记本。"""
    nb = str(notebook_name or "").strip()
    if not nb or is_author_ip_notebook_name(nb):
        raise ValueError("invalid_notebook")
    existing = get_author_ip_by_notebook(user_ref, nb)
    if existing:
        return existing
    ensure_author_ip_schema()
    display = nb[:120]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raise ValueError("not_logged_in")
            ip_row = _insert_ip_row(
                cur,
                user_uuid=user_uuid,
                display_name=display,
                subtitle="",
                avatar_color="brand",
                notebook_name=nb,
                is_default=False,
                is_system_seed=False,
                is_template=False,
                is_read_only=False,
                template_id=None,
                maturity="empty",
                one_liner="",
                profile={},
            )
            conn.commit()
            ip_id = str(ip_row["id"])
    item = get_author_ip(user_ref, ip_id)
    if not item:
        raise ValueError("ip_create_failed")
    return item


def rename_author_ip_for_notebook(
    user_ref: str | None,
    notebook_name: str,
    display_name: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """按用户笔记本名更新绑定 IP 的 display_name（不存在则懒创建）。"""
    nb = str(notebook_name or "").strip()
    name = str(display_name or "").strip()
    if not nb or is_author_ip_notebook_name(nb):
        return None, "无效的笔记本"
    if not name:
        return None, "名称不能为空"
    try:
        item = ensure_author_ip_for_notebook(user_ref, nb)
    except ValueError as exc:
        return None, str(exc)
    ip_id = str(item.get("id") or "").strip()
    if not ip_id:
        return None, "IP 不存在"
    return patch_author_ip(user_ref, ip_id, display_name=name)


def patch_author_ip(
    user_ref: str | None,
    ip_id: str,
    *,
    display_name: str | None = None,
    subtitle: str | None = None,
    avatar_color: str | None = None,
    is_default: bool | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    ensure_author_ip_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return None, "未登录"
            cur.execute(
                """
                SELECT * FROM author_ips
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid, ip_id),
            )
            row = cur.fetchone()
            if not row:
                return None, "IP 不存在"
            if bool(row.get("is_read_only")):
                return None, "该风格为只读，无法修改"
            if display_name is not None:
                name = str(display_name).strip()
                if not name:
                    return None, "名称不能为空"
                cur.execute(
                    "UPDATE author_ips SET display_name = %s, updated_at = NOW() WHERE id = %s::uuid",
                    (name[:120], ip_id),
                )
            if subtitle is not None:
                cur.execute(
                    "UPDATE author_ips SET subtitle = %s, updated_at = NOW() WHERE id = %s::uuid",
                    (str(subtitle).strip()[:200], ip_id),
                )
            if avatar_color is not None:
                cur.execute(
                    "UPDATE author_ips SET avatar_color = %s, updated_at = NOW() WHERE id = %s::uuid",
                    (str(avatar_color).strip()[:40] or "brand", ip_id),
                )
            if is_default is True:
                _clear_default_flag(cur, user_uuid, except_ip_id=ip_id)
                cur.execute(
                    "UPDATE author_ips SET is_default = TRUE, updated_at = NOW() WHERE id = %s::uuid",
                    (ip_id,),
                )
            conn.commit()
    item = get_author_ip(user_ref, ip_id)
    return item, None


def note_is_author_ip_material(metadata: dict[str, Any] | None, notebook: str | None) -> bool:
    md = metadata if isinstance(metadata, dict) else {}
    if str(md.get("authorIpId") or "").strip():
        return True
    return is_author_ip_notebook_name(notebook)


def author_ip_display_name_map(user_ref: str | None) -> dict[str, str]:
    """含已归档 IP，供回收站展示所属 IP 名称。"""
    out: dict[str, str] = {}
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return out
            cur.execute(
                """
                SELECT id::text AS id, display_name
                FROM author_ips
                WHERE user_id = %s::uuid
                """,
                (user_uuid,),
            )
            for row in cur.fetchall() or []:
                rid = str(row.get("id") or "").strip()
                if rid:
                    out[rid] = str(row.get("display_name") or "个人特色 IP")
    return out


def author_ip_is_active(user_ref: str | None, ip_id: str) -> bool:
    if not str(ip_id or "").strip():
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return False
            cur.execute(
                """
                SELECT 1 FROM author_ips
                WHERE user_id = %s::uuid AND id = %s::uuid AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid, ip_id),
            )
            return cur.fetchone() is not None


def list_author_ip_notebook_names(user_ref: str | None) -> set[str]:
    names: set[str] = set()
    for item in list_author_ips(user_ref):
        nb = str(item.get("notebookName") or "").strip()
        if nb:
            names.add(nb)
    return names


def exclude_author_ip_notebooks(names: list[str], user_ref: str | None) -> list[str]:
    """仅排除系统隐藏本 ``__author_ip:*``。

    v6 用户笔记本与 author_ips 1:1 绑定后仍应出现在列表中；
    勿按「已绑定 IP」整本过滤，否则上传/提炼后笔记本会从侧栏消失。
    """
    del user_ref
    return [n for n in names if not is_author_ip_notebook_name(n)]


def list_user_notebook_kinds_meta(user_ref: str | None) -> dict[str, dict[str, Any]]:
    """保留 notebooks API 兼容；参考资料列表已过滤 IP 本。"""
    out: dict[str, dict[str, Any]] = {}
    for item in list_author_ips(user_ref):
        nb = str(item.get("notebookName") or "").strip()
        if not nb:
            continue
        out[nb] = {
            "kind": "author_ip",
            "authorIpId": item.get("id"),
            "isTemplate": bool(item.get("isTemplate")),
            "isSystemSeed": bool(item.get("isSystemSeed")),
        }
    return out


def order_notebook_names_for_list(names: list[str], kinds: dict[str, dict[str, Any]]) -> list[str]:
    if not kinds:
        return names
    ref: list[str] = []
    ip_names: list[str] = []
    for n in names:
        if kinds.get(n, {}).get("kind") == "author_ip":
            ip_names.append(n)
        else:
            ref.append(n)
    return ref + ip_names


def notebook_is_system_reserved(user_ref: str | None, notebook_name: str) -> bool:
    if not is_author_ip_notebook_name(notebook_name):
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return False
            cur.execute(
                """
                SELECT is_system_seed, is_template FROM author_ips
                WHERE user_id = %s::uuid AND notebook_name = %s AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid, notebook_name),
            )
            row = cur.fetchone()
            if not row:
                return False
            return bool(row.get("is_system_seed")) or bool(row.get("is_template"))
    return False


def guard_notebook_mutation(user_ref: str | None, notebook_name: str, *, action: str) -> str | None:
    if not is_author_ip_notebook_name(notebook_name):
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return None
            cur.execute(
                """
                SELECT display_name, is_system_seed, is_template, is_read_only
                FROM author_ips
                WHERE user_id = %s::uuid AND notebook_name = %s AND archived_at IS NULL
                LIMIT 1
                """,
                (user_uuid, notebook_name),
            )
            row = cur.fetchone()
            if not row:
                return "请在「个人特色 IP」中管理该笔记本"
            label = str(row.get("display_name") or "个人特色 IP")
            if bool(row.get("is_system_seed")):
                if action == "delete":
                    return "「我的 IP」不可删除，请在个人特色 IP 页改名或完善素材"
                if action == "rename":
                    return "请前往「个人特色 IP」页面修改「我的 IP」名称"
            if bool(row.get("is_template")) or bool(row.get("is_read_only")):
                if action in ("delete", "rename"):
                    return f"「{label}」为示例 IP，请在个人特色 IP 页复制后编辑"
            if action in ("delete", "rename", "create"):
                return f"「{label}」绑定个人特色 IP，请在侧栏「个人特色 IP」中管理"
    return None
