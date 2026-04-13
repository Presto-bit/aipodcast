import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from psycopg2 import IntegrityError

from .db import get_conn, get_cursor
from .subscription_manifest import MONTHLY_MINUTES_PRODUCT_BY_TIER, USER_SUBSCRIPTION_TIERS
from .usage_billing import build_usage_event_meta

logger = logging.getLogger(__name__)

_usage_events_user_id_schema_ready = False

LEGACY_DEFAULT_NOTEBOOK = "默认笔记本"
# 笔记播客页创建的任务 project_name（与 apps/web/lib/notesProject 一致）
NOTES_PODCAST_STUDIO_PROJECT = "notes-podcast-studio"


def _normalize_phone_digits(phone: str | None) -> str:
    raw = str(phone or "")
    return "".join(ch for ch in raw if ch.isdigit())


def _normalize_user_uuid(user_ref: str | None) -> str | None:
    """
    DB `projects.user_id` / `jobs.created_by` are UUID foreign keys.
    The web layer may pass phone numbers; write NULL instead of raising SQL errors.
    """
    raw = (user_ref or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except (TypeError, ValueError, AttributeError):
        return None


def _resolve_user_uuid_from_ref(cur: Any, user_ref: str | None) -> str | None:
    """
    Resolve `created_by` to real users.id(UUID):
    1) if input looks like UUID and exists in users.id -> use it
    2) else lookup by users.phone / phone_normalized
    3) else lookup by lower(email) / lower(username)
    """
    raw = (user_ref or "").strip()
    if not raw:
        return None

    uuid_candidate = _normalize_user_uuid(raw)
    if uuid_candidate:
        cur.execute("SELECT id FROM users WHERE id = %s LIMIT 1", (uuid_candidate,))
        row = cur.fetchone()
        if row and row.get("id") is not None:
            return str(row["id"])

    p_norm = _normalize_phone_digits(raw)
    cur.execute(
        "SELECT id FROM users WHERE phone = %s OR (phone_normalized IS NOT NULL AND phone_normalized = %s) LIMIT 1",
        (raw, p_norm),
    )
    row = cur.fetchone()
    if row and row.get("id") is not None:
        return str(row["id"])
    if "@" in raw:
        cur.execute(
            "SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim(%s)) LIMIT 1",
            (raw,),
        )
        row = cur.fetchone()
        if row and row.get("id") is not None:
            return str(row["id"])
    cur.execute(
        "SELECT id FROM users WHERE lower(btrim(username)) = lower(btrim(%s)) LIMIT 1",
        (raw,),
    )
    row = cur.fetchone()
    if row and row.get("id") is not None:
        return str(row["id"])
    return None


def phone_for_job_created_by(created_by: str | None) -> str:
    """
    `jobs.created_by` 存的是 `users.id`（UUID）。Worker 里做套餐/笔记条数等需调用
    `user_info_for_phone` 时，应先把 UUID 解析为手机号；若已是手机号则原样返回。
    """
    raw = (created_by or "").strip()
    if not raw:
        return ""
    uid = _normalize_user_uuid(raw)
    if not uid:
        return raw
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute("SELECT phone FROM users WHERE id = %s::uuid LIMIT 1", (uid,))
                row = cur.fetchone()
        if row and row.get("phone"):
            return str(row["phone"]).strip()
    except Exception:
        pass
    return ""


def _resolve_user_uuid_or_none(cur: Any, user_ref: str | None) -> str | None:
    """解析用户标识；空值表示不做用户隔离过滤（兼容本地未鉴权模式）。"""
    raw = (user_ref or "").strip()
    if not raw:
        return None
    return _resolve_user_uuid_from_ref(cur, raw)


def resolved_user_uuid_string(user_ref: str | None) -> str | None:
    """供路由层生成带用户前缀的对象存储 key（无额外 SQL 封装在单次连接内）。"""
    if not (user_ref or "").strip():
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            return _resolve_user_uuid_or_none(cur, user_ref)


def ensure_default_project(project_name: str, created_by: str | None = None) -> str:
    """按 (name, user_id) 复用已有项目行，避免重复 INSERT 与孤立 project 行导致笔记上传异常。"""
    pn = (project_name or "").strip()
    if not pn:
        raise ValueError("project_name_required")
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            owner_user_id = _resolve_user_uuid_from_ref(cur, created_by)
            cur.execute(
                """
                SELECT id FROM projects
                WHERE name = %s AND (user_id IS NOT DISTINCT FROM %s)
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (pn, owner_user_id),
            )
            existing = cur.fetchone()
            if existing and existing.get("id") is not None:
                conn.commit()
                return str(existing["id"])
            cur.execute(
                """
                INSERT INTO projects (name, user_id)
                VALUES (%s, %s)
                RETURNING id
                """,
                (pn, owner_user_id),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row["id"])


def create_job(project_id: str, job_type: str, queue_name: str, payload: dict[str, Any], created_by: str | None) -> str:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            creator_user_id = _resolve_user_uuid_from_ref(cur, created_by)
            cur.execute(
                """
                INSERT INTO jobs (project_id, job_type, queue_name, payload, status, created_by)
                VALUES (%s, %s, %s, %s::jsonb, 'queued', %s)
                RETURNING id
                """,
                (project_id, job_type, queue_name, json.dumps(payload), creator_user_id),
            )
            job_row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, event_payload)
                VALUES (%s, 'progress', '任务已进入队列', %s::jsonb)
                """,
                (str(job_row["id"]), json.dumps({"status": "queued", "progress": 0})),
            )
            conn.commit()
            return str(job_row["id"])


def append_job_event(job_id: str, event_type: str, message: str, payload: dict[str, Any] | None = None) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, event_payload)
                VALUES (%s, %s, %s, %s::jsonb)
                """,
                (job_id, event_type, message, json.dumps(payload or {})),
            )
            conn.commit()


def try_mark_job_running(job_id: str, progress: float = 5.0) -> bool:
    """仅当状态为 queued 时置为 running，避免覆盖用户已取消等终态。"""
    jid = (job_id or "").strip()
    if not jid:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE jobs
                SET status = 'running', updated_at = NOW(),
                    started_at = COALESCE(started_at, NOW()), progress = %s
                WHERE id = %s AND status = 'queued'
                """,
                (progress, jid),
            )
            ok = cur.rowcount > 0
            conn.commit()
    return ok


def finalize_job_terminal_unless_cancelled(
    job_id: str,
    status: str,
    progress: float | None = None,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> bool:
    """写入 succeeded / failed；若当前已为 cancelled 则不覆盖（防止取消后仍被 worker 写成成功）。"""
    if status not in ("succeeded", "failed"):
        raise ValueError("finalize_job_terminal_unless_cancelled expects succeeded or failed")
    jid = (job_id or "").strip()
    if not jid:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            pieces = ["status = %s", "updated_at = NOW()", "completed_at = NOW()"]
            values: list[Any] = [status]
            if progress is not None:
                pieces.append("progress = %s")
                values.append(progress)
            if result is not None:
                pieces.append("result = %s::jsonb")
                values.append(json.dumps(result))
            if error_message is not None:
                pieces.append("error_message = %s")
                values.append(error_message)
            values.append(jid)
            sql = f"UPDATE jobs SET {', '.join(pieces)} WHERE id = %s AND status <> 'cancelled'"
            cur.execute(sql, values)
            updated = cur.rowcount > 0
            conn.commit()
    if updated:
        _try_record_usage_on_terminal(jid, status)
    return updated


def cancel_job_if_runnable(job_id: str) -> str:
    """
    将 queued/running 任务标为 cancelled。
    返回: 'cancelled' | 'not_found' | 'noop'（已是终态）
    """
    jid = (job_id or "").strip()
    if not jid:
        return "not_found"
    row = get_job(jid)
    if not row:
        return "not_found"
    st = str(row.get("status") or "")
    if st not in ("queued", "running"):
        return "noop"
    progress = float(row.get("progress") or 0)
    update_job_status(jid, "cancelled", progress=progress)
    return "cancelled"


def update_job_status(
    job_id: str,
    status: str,
    progress: float | None = None,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            pieces = ["status = %s", "updated_at = NOW()"]
            values: list[Any] = [status]
            if status == "running":
                pieces.append("started_at = COALESCE(started_at, NOW())")
            if status in ("succeeded", "failed", "cancelled"):
                pieces.append("completed_at = NOW()")
            if progress is not None:
                pieces.append("progress = %s")
                values.append(progress)
            if result is not None:
                pieces.append("result = %s::jsonb")
                values.append(json.dumps(result))
            if error_message is not None:
                pieces.append("error_message = %s")
                values.append(error_message)
            values.append(job_id)
            sql = f"UPDATE jobs SET {', '.join(pieces)} WHERE id = %s"
            cur.execute(sql, values)
            conn.commit()
    if status in ("succeeded", "failed", "cancelled"):
        _try_record_usage_on_terminal(job_id, status)


def _coerce_job_result_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            j = json.loads(raw)
            return dict(j) if isinstance(j, dict) else {}
        except Exception:
            return {}
    return {}


def merge_job_result(job_id: str, user_ref: str | None, patch: dict[str, Any]) -> str | None:
    """
    将 patch 浅层合并进 jobs.result（仅终态任务）。
    成功返回 None；失败返回错误码字符串。
    """
    jid = (job_id or "").strip()
    if not jid or not patch:
        return "invalid_args"
    row = get_job(jid, user_ref=user_ref)
    if not row:
        return "job_not_found"
    if str(row.get("status") or "") != "succeeded":
        return "job_not_succeeded"
    merged = _coerce_job_result_dict(row.get("result"))
    merged.update(patch)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE jobs SET result = %s::jsonb, updated_at = NOW() WHERE id = %s",
                (json.dumps(merged, ensure_ascii=False, default=str), jid),
            )
            conn.commit()
    return None


def get_job(job_id: str, user_ref: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                SELECT j.*
                FROM jobs j
                LEFT JOIN projects p ON p.id = j.project_id
                WHERE j.id = %s
                  AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                """,
                (job_id, user_uuid, user_uuid),
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            if user_uuid:
                cur.execute("SELECT 1 FROM jobs WHERE id = %s", (job_id,))
                if cur.fetchone():
                    from .security_audit import log_idor_denied

                    log_idor_denied("job", str(job_id), user_ref)
            return None


def list_job_events(job_id: str, after_id: int = 0) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, job_id, event_type, message, event_payload, created_at
                FROM job_events
                WHERE job_id = %s AND id > %s
                ORDER BY id ASC
                """,
                (job_id, after_id),
            )
            return [dict(x) for x in cur.fetchall()]


def add_artifact(job_id: str, artifact_type: str, object_key: str, mime_type: str = "text/plain") -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO artifacts (job_id, artifact_type, object_key, mime_type)
                VALUES (%s, %s, %s, %s)
                """,
                (job_id, artifact_type, object_key, mime_type),
            )
            conn.commit()


def ensure_notebooks_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS notebooks (
                  name TEXT PRIMARY KEY,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_notebooks (
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  name TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (user_id, name)
                );
                """
            )
            try:
                cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_inputs_note_deleted ON inputs (deleted_at)
                    WHERE input_type IN ('note_text', 'note_file')
                    """
                )
            except Exception:
                pass
            conn.commit()


def ensure_jobs_trash_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at
                ON jobs (deleted_at, completed_at DESC, created_at DESC)
                """
            )
            conn.commit()


def migrate_legacy_default_notebook_for_user(user_ref: str | None) -> None:
    """移除用户侧「默认笔记本」登记行；历史笔记 metadata 仍可为该名（由列表 DISTINCT 自然展示）。幂等。"""
    raw = (user_ref or "").strip()
    if not raw:
        return
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
                if not user_uuid:
                    return
                cur.execute(
                    "DELETE FROM user_notebooks WHERE user_id = %s::uuid AND name = %s",
                    (user_uuid, LEGACY_DEFAULT_NOTEBOOK),
                )
                conn.commit()
    except Exception:
        return


def register_notebook_name(name: str) -> None:
    nb = (name or "").strip()
    if not nb:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("INSERT INTO notebooks (name) VALUES (%s) ON CONFLICT DO NOTHING", (nb,))
            conn.commit()


def register_notebook_name_for_user(name: str, user_ref: str | None) -> None:
    nb = (name or "").strip()
    if not nb:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if user_uuid:
                cur.execute(
                    """
                    INSERT INTO user_notebooks (user_id, name)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (user_uuid, nb),
                )
            conn.commit()


def list_notebook_names(user_ref: str | None = None) -> list[str]:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            names = set()
            if user_uuid:
                cur.execute(
                    """
                    SELECT name FROM user_notebooks
                    WHERE user_id = %s
                    ORDER BY name ASC
                    """,
                    (user_uuid,),
                )
                names = {str(r["name"]) for r in cur.fetchall()}
            else:
                cur.execute("SELECT name FROM notebooks")
                for r in cur.fetchall():
                    nb = str(r["name"] or "").strip()
                    if nb:
                        names.add(nb)
            cur.execute(
                """
                SELECT DISTINCT i.metadata->>'notebook' AS nb
                FROM inputs i
                JOIN projects p ON p.id = i.project_id
                WHERE i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND COALESCE(i.metadata->>'notebook','') <> ''
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                """,
                (user_uuid, user_uuid),
            )
            for r in cur.fetchall():
                n = str(r["nb"] or "").strip()
                if n:
                    names.add(n)
            return sorted(names)


def create_notebook_only(name: str, user_ref: str | None = None) -> tuple[bool, str]:
    nb = (name or "").strip()
    if not nb:
        return False, "笔记本名称不能为空"
    if nb == LEGACY_DEFAULT_NOTEBOOK:
        return False, "该名称保留给历史数据，请换一个名称"
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                raw = (user_ref or "").strip()
                if raw:
                    return False, "未登录"
                # 未开鉴权：无 user_ref，写入全局 notebooks 表（与 register_notebook_name 一致）
                cur.execute("SELECT 1 FROM notebooks WHERE name = %s", (nb,))
                if cur.fetchone():
                    return False, "该名称已存在"
                cur.execute(
                    "INSERT INTO notebooks (name) VALUES (%s) ON CONFLICT DO NOTHING",
                    (nb,),
                )
                conn.commit()
                return True, nb
            cur.execute(
                "SELECT 1 FROM user_notebooks WHERE user_id = %s AND name = %s",
                (user_uuid, nb),
            )
            if cur.fetchone():
                return False, "该名称已存在"
            try:
                cur.execute(
                    "INSERT INTO user_notebooks (user_id, name) VALUES (%s, %s)",
                    (user_uuid, nb),
                )
                conn.commit()
            except IntegrityError:
                conn.rollback()
                return False, "该名称已存在"
    return True, nb


def rename_notebook_db(old: str, new_name: str, user_ref: str | None = None) -> tuple[bool, str]:
    o = (old or "").strip()
    n = (new_name or "").strip()
    if not o or not n:
        return False, "名称不能为空"
    if n == LEGACY_DEFAULT_NOTEBOOK:
        return False, "不能使用该名称"
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return False, "未登录"
            cur.execute(
                "SELECT 1 FROM user_notebooks WHERE user_id = %s AND name = %s",
                (user_uuid, o),
            )
            if not cur.fetchone():
                return False, "笔记本不存在"
            cur.execute(
                "SELECT 1 FROM user_notebooks WHERE user_id = %s AND name = %s AND name <> %s",
                (user_uuid, n, o),
            )
            if cur.fetchone():
                return False, "该名称已存在"
            cur.execute(
                "UPDATE user_notebooks SET name = %s WHERE user_id = %s AND name = %s",
                (n, user_uuid, o),
            )
            cur.execute(
                """
                UPDATE inputs i
                SET metadata = jsonb_set(i.metadata, '{notebook}', to_jsonb(%s::text), true)
                FROM projects p
                WHERE i.project_id = p.id
                  AND p.user_id = %s
                  AND i.metadata->>'notebook' = %s
                  AND i.input_type IN ('note_text', 'note_file')
                """,
                (n, user_uuid, o),
            )
            conn.commit()
    return True, ""


def trash_jobs_for_notes_notebook(notebook_name: str, user_ref: str | None = None) -> int:
    """将笔记工作室项目中，与该笔记本关联的播客/文章任务移入作品回收站（软删除）。"""
    n = (notebook_name or "").strip()
    if not n:
        return 0
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return 0
            cur.execute(
                """
                UPDATE jobs j
                SET deleted_at = NOW(),
                    updated_at = NOW(),
                    payload = COALESCE(j.payload::jsonb, '{}'::jsonb)
                      || jsonb_build_object('notes_notebook_studio_detach', true)
                FROM projects p
                WHERE j.project_id = p.id
                  AND p.user_id = %s::uuid
                  AND p.name = %s
                  AND j.deleted_at IS NULL
                  AND j.job_type IN ('podcast_generate', 'script_draft')
                  AND (
                    j.payload::jsonb->>'notes_notebook' = %s
                    OR EXISTS (
                      SELECT 1
                      FROM inputs i
                      JOIN projects pi ON pi.id = i.project_id
                      WHERE pi.user_id = %s::uuid
                        AND i.input_type IN ('note_text', 'note_file')
                        AND COALESCE(i.metadata->>'notebook', '') = %s
                        AND i.deleted_at IS NULL
                        AND i.id::text IN (
                          SELECT jsonb_array_elements_text(
                            COALESCE(j.payload::jsonb->'selected_note_ids', '[]'::jsonb)
                          )
                        )
                    )
                  )
                """,
                (
                    user_uuid,
                    NOTES_PODCAST_STUDIO_PROJECT,
                    n,
                    user_uuid,
                    n,
                ),
            )
            cnt = cur.rowcount
            conn.commit()
            return int(cnt or 0)


def purge_inputs_in_notebook_hard(notebook_name: str, user_ref: str | None = None) -> tuple[int, list[str]]:
    """永久删除某笔记本下的笔记行，返回 (删除条数, 待清理的对象存储 key)。"""
    n = (notebook_name or "").strip()
    if not n:
        return 0, []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return 0, []
            cur.execute(
                """
                DELETE FROM inputs i
                USING projects p
                WHERE i.project_id = p.id
                  AND p.user_id = %s::uuid
                  AND i.input_type IN ('note_text', 'note_file')
                  AND COALESCE(i.metadata->>'notebook', '') = %s
                RETURNING i.file_object_key
                """,
                (user_uuid, n),
            )
            rows = cur.fetchall()
            keys = [str(r.get("file_object_key") or "").strip() for r in rows]
            keys = [k for k in keys if k]
            n_deleted = len(rows)
            conn.commit()
            return n_deleted, keys


def delete_notebook_db(name: str, user_ref: str | None = None) -> tuple[bool, str, int, int]:
    """删除笔记本：关联作品进回收站，笔记永久删除。返回 (ok, err, notes_purged, jobs_trashed)。"""
    n = (name or "").strip()
    if not n:
        return False, "名称不能为空", 0, 0
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return False, "未登录", 0, 0
            cur.execute(
                "SELECT 1 FROM user_notebooks WHERE user_id = %s AND name = %s",
                (user_uuid, n),
            )
            if not cur.fetchone():
                return False, "笔记本不存在", 0, 0
            conn.commit()

    jobs_n = trash_jobs_for_notes_notebook(n, user_ref=user_ref)
    notes_n, file_keys = purge_inputs_in_notebook_hard(n, user_ref=user_ref)

    from .object_store import delete_object_key

    for k in file_keys:
        try:
            delete_object_key(k)
        except Exception:
            pass

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if not user_uuid:
                return False, "未登录", notes_n, jobs_n
            cur.execute("DELETE FROM user_notebooks WHERE user_id = %s AND name = %s", (user_uuid, n))
            conn.commit()
    return True, "", notes_n, jobs_n


def create_text_note(
    project_id: str,
    title: str,
    notebook: str,
    content: str,
    source_url: str | None = None,
    user_ref: str | None = None,
) -> str:
    nb = (notebook or "").strip()
    if not nb:
        raise ValueError("notebook_required")
    register_notebook_name_for_user(nb, user_ref)
    metadata = {"title": title, "notebook": nb}
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO inputs (project_id, input_type, content_text, source_url, metadata)
                VALUES (%s, 'note_text', %s, %s, %s::jsonb)
                RETURNING id
                """,
                (project_id, content, source_url, json.dumps(metadata)),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row["id"])


def create_file_note(
    project_id: str,
    title: str,
    notebook: str,
    content_text: str,
    file_object_key: str,
    ext: str,
    original_filename: str,
    size: int | None,
    source_url: str | None = None,
    user_ref: str | None = None,
) -> str:
    nb = (notebook or "").strip()
    if not nb:
        raise ValueError("notebook_required")
    register_notebook_name_for_user(nb, user_ref)
    metadata: dict[str, Any] = {
        "title": title,
        "notebook": nb,
        "ext": ext,
        "original_filename": original_filename,
    }
    if size is not None:
        metadata["size"] = size
    if source_url:
        metadata["sourceUrl"] = source_url
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO inputs (project_id, input_type, content_text, source_url, file_object_key, metadata)
                VALUES (%s, 'note_file', %s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (project_id, content_text, source_url, file_object_key, json.dumps(metadata)),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row["id"])


def list_notes(
    notebook: str | None = None, limit: int = 200, offset: int = 0, user_ref: str | None = None
) -> list[dict[str, Any]]:
    nb_filter = (notebook or "").strip()
    lim = max(1, min(500, int(limit)))
    off = max(0, min(50_000, int(offset)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if nb_filter:
                cur.execute(
                    """
                    SELECT i.id, i.content_text, i.source_url, i.metadata, i.created_at, i.file_object_key, i.input_type
                    FROM inputs i
                    JOIN projects p ON p.id = i.project_id
                    WHERE i.input_type IN ('note_text', 'note_file')
                      AND i.deleted_at IS NULL
                      AND (i.metadata->>'notebook') = %s
                      AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                    ORDER BY i.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (nb_filter, user_uuid, user_uuid, lim, off),
                )
            else:
                cur.execute(
                    """
                    SELECT i.id, i.content_text, i.source_url, i.metadata, i.created_at, i.file_object_key, i.input_type
                    FROM inputs i
                    JOIN projects p ON p.id = i.project_id
                    WHERE i.input_type IN ('note_text', 'note_file')
                      AND i.deleted_at IS NULL
                      AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                    ORDER BY i.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (user_uuid, user_uuid, lim, off),
                )
            return [dict(x) for x in cur.fetchall()]


def get_note_by_id(note_id: str, include_deleted: bool = False, user_ref: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            del_clause = "" if include_deleted else "AND deleted_at IS NULL"
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                f"""
                SELECT i.id, i.content_text, i.source_url, i.metadata, i.created_at, i.file_object_key, i.input_type, i.deleted_at,
                       i.note_summary, i.note_rag_body_hash
                FROM inputs i
                JOIN projects p ON p.id = i.project_id
                WHERE i.id = %s AND i.input_type IN ('note_text', 'note_file')
                AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                {del_clause}
                """,
                (note_id, user_uuid, user_uuid),
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            if user_uuid:
                cur.execute(
                    """
                    SELECT 1 FROM inputs i
                    WHERE i.id = %s AND i.input_type IN ('note_text', 'note_file')
                    """,
                    (note_id,),
                )
                if cur.fetchone():
                    from .security_audit import log_idor_denied

                    log_idor_denied("note", str(note_id), user_ref)
            return None


def update_note_title(note_id: str, new_title: str, user_ref: str | None = None) -> bool:
    t = (new_title or "").strip()
    if not t:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                UPDATE inputs i
                SET metadata = jsonb_set(i.metadata, '{title}', to_jsonb(%s::text), true)
                FROM projects p
                WHERE i.project_id = p.id
                  AND i.id = %s
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                """,
                (t, note_id, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def delete_note(note_id: str, user_ref: str | None = None) -> bool:
    """移入回收站（软删除）。"""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                UPDATE inputs i SET deleted_at = NOW()
                FROM projects p
                WHERE i.project_id = p.id
                  AND i.id = %s
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                """,
                (note_id, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def list_trashed_notes(limit: int = 100, offset: int = 0, user_ref: str | None = None) -> list[dict[str, Any]]:
    lim = max(1, min(500, int(limit)))
    off = max(0, min(50_000, int(offset)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                SELECT i.id, i.content_text, i.source_url, i.metadata, i.created_at, i.file_object_key, i.input_type, i.deleted_at
                FROM inputs i
                JOIN projects p ON p.id = i.project_id
                WHERE i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NOT NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                ORDER BY i.deleted_at DESC
                LIMIT %s OFFSET %s
                """,
                (user_uuid, user_uuid, lim, off),
            )
            return [dict(x) for x in cur.fetchall()]


def restore_note(note_id: str, user_ref: str | None = None) -> bool:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                UPDATE inputs i SET deleted_at = NULL
                FROM projects p
                WHERE i.project_id = p.id
                  AND i.id = %s
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NOT NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                """,
                (note_id, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def purge_note_hard(note_id: str, user_ref: str | None = None) -> bool:
    """永久删除（回收站清空）。"""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                DELETE FROM inputs i
                USING projects p
                WHERE i.project_id = p.id
                  AND i.id = %s
                  AND i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NOT NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                """,
                (note_id, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def purge_expired_trashed_notes(retention_days: int = 7, max_rows: int = 200) -> int:
    """清理超过保留期的已删除笔记（含文件对象）。"""
    days = max(1, min(365, int(retention_days)))
    lim = max(1, min(500, int(max_rows)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id::text AS id, file_object_key
                FROM inputs
                WHERE input_type IN ('note_text', 'note_file')
                  AND deleted_at IS NOT NULL
                  AND deleted_at < NOW() - make_interval(days => %s)
                ORDER BY deleted_at ASC
                LIMIT %s
                """,
                (days, lim),
            )
            rows = [dict(x) for x in cur.fetchall()]
    deleted_count = 0
    for row in rows:
        nid = str(row.get("id") or "").strip()
        if not nid:
            continue
        if purge_note_hard(nid):
            key = str(row.get("file_object_key") or "").strip()
            if key:
                try:
                    from .object_store import delete_object_key

                    delete_object_key(key)
                except Exception:
                    pass
            deleted_count += 1
    return deleted_count


def delete_job_and_storage(job_id: str) -> tuple[bool, str]:
    """删除任务行（级联 job_events、artifacts），并尽量删除关联对象存储文件。"""
    jid = (job_id or "").strip()
    if not jid:
        return False, "invalid_job_id"
    row = get_job(jid)
    if not row:
        return False, "not_found"

    arts = list_job_artifacts(jid)
    raw_res = row.get("result")
    if isinstance(raw_res, str):
        try:
            result: dict[str, Any] = json.loads(raw_res)
        except Exception:
            result = {}
    elif isinstance(raw_res, dict):
        result = raw_res
    else:
        result = {}

    keys: set[str] = set()
    for a in arts:
        k = str(a.get("object_key") or "").strip()
        if k:
            keys.add(k)
    for fk in ("script_object_key", "script_url", "cover_object_key"):
        v = result.get(fk)
        if isinstance(v, str) and v.strip() and not v.strip().lower().startswith("http"):
            keys.add(v.strip())

    from .object_store import delete_object_key

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s", (jid,))
            deleted = cur.rowcount > 0
            conn.commit()
    if not deleted:
        return False, "not_found"
    for k in keys:
        delete_object_key(k)
    return True, ""


def soft_delete_job(job_id: str, user_ref: str | None = None) -> bool:
    jid = (job_id or "").strip()
    if not jid:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            # EXISTS 与 get_job / list_jobs 的 LEFT JOIN + COALESCE(created_by, p.user_id) 完全一致，避免单表子查询边界差异
            cur.execute(
                """
                UPDATE jobs j
                SET deleted_at = NOW(), updated_at = NOW()
                WHERE j.id = %s
                  AND j.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jobs j2
                    LEFT JOIN projects p ON p.id = j2.project_id
                    WHERE j2.id = j.id
                      AND (%s::uuid IS NULL OR COALESCE(j2.created_by, p.user_id) = %s::uuid)
                  )
                """,
                (jid, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def restore_deleted_job(job_id: str, user_ref: str | None = None) -> bool:
    jid = (job_id or "").strip()
    if not jid:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                UPDATE jobs j
                SET deleted_at = NULL, updated_at = NOW()
                WHERE j.id = %s
                  AND j.deleted_at IS NOT NULL
                  AND (
                    %s::uuid IS NULL
                    OR COALESCE(
                      j.created_by,
                      (SELECT p.user_id FROM projects p WHERE p.id = j.project_id LIMIT 1)
                    ) = %s::uuid
                  )
                """,
                (jid, user_uuid, user_uuid),
            )
            ok = cur.rowcount > 0
            conn.commit()
            return ok


def list_trashed_works(limit: int = 120, offset: int = 0, user_ref: str | None = None) -> list[dict[str, Any]]:
    lim = max(1, min(200, int(limit)))
    off = max(0, min(10_000, int(offset)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                SELECT j.id, j.job_type, j.status, j.result, j.created_at, j.completed_at, j.project_id, j.deleted_at
                FROM jobs j
                LEFT JOIN projects p ON p.id = j.project_id
                WHERE j.status = 'succeeded'
                  AND j.deleted_at IS NOT NULL
                  AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                ORDER BY j.deleted_at DESC, j.completed_at DESC NULLS LAST, j.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (user_uuid, user_uuid, lim, off),
            )
            return [dict(x) for x in cur.fetchall()]


def purge_expired_trashed_works(retention_days: int = 7, max_rows: int = 200) -> int:
    """清理超过保留期的已删除作品（硬删除并回收对象存储）。"""
    days = max(1, min(365, int(retention_days)))
    lim = max(1, min(500, int(max_rows)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id::text AS id
                FROM jobs
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - make_interval(days => %s)
                ORDER BY deleted_at ASC
                LIMIT %s
                """,
                (days, lim),
            )
            rows = [str(x.get("id") or "").strip() for x in cur.fetchall()]
    deleted_count = 0
    for jid in rows:
        if not jid:
            continue
        ok, _ = delete_job_and_storage(jid)
        if ok:
            deleted_count += 1
    return deleted_count


def list_recent_works(
    limit: int = 120,
    offset: int = 0,
    user_ref: str | None = None,
    *,
    slim_result: bool = True,
) -> list[dict[str, Any]]:
    """
    成功态作品列表。slim_result=True 时仅在 SQL 层投影 result 白名单，避免巨大 audio_hex 进入 API 进程。
    """
    lim = max(1, min(200, int(limit)))
    off = max(0, min(10_000, int(offset)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if slim_result:
                cur.execute(
                    """
                    SELECT j.id, j.job_type, j.status,
                      CASE
                        WHEN j.result IS NULL OR jsonb_typeof(j.result) != 'object' THEN '{}'::jsonb
                        ELSE jsonb_strip_nulls(
                          jsonb_build_object(
                            'preview', j.result->'preview',
                            'script_preview', j.result->'script_preview',
                            'title', j.result->'title',
                            'audio_url', j.result->'audio_url',
                            'script_url', j.result->'script_url',
                            'audio_duration_sec', j.result->'audio_duration_sec',
                            'cover_image', COALESCE(j.result->'cover_image', j.result->'coverImage'),
                            'audio_object_key', j.result->'audio_object_key',
                            'script_char_count', j.result->'script_char_count',
                            'notes_source_notebook', j.result->'notes_source_notebook',
                            'notes_source_note_count', j.result->'notes_source_note_count',
                            'notes_source_titles', j.result->'notes_source_titles',
                            'has_audio_hex', to_jsonb(
                              (j.result ? 'audio_hex' AND COALESCE(LENGTH(j.result->>'audio_hex'), 0) > 0)
                              OR (
                                (j.result ? 'audio_object_key')
                                AND LENGTH(TRIM(COALESCE(j.result->>'audio_object_key', ''))) > 0
                              )
                            )
                          )
                        )
                      END AS result,
                      j.payload, j.created_at, j.completed_at, j.project_id
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.status = 'succeeded'
                      AND j.deleted_at IS NULL
                      AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                    ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (user_uuid, user_uuid, lim, off),
                )
            else:
                cur.execute(
                    """
                    SELECT j.id, j.job_type, j.status, j.result, j.payload, j.created_at, j.completed_at, j.project_id
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.status = 'succeeded'
                      AND j.deleted_at IS NULL
                      AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                    ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (user_uuid, user_uuid, lim, off),
                )
            return [dict(x) for x in cur.fetchall()]


def user_usage_for_phone(phone: str, days: int = 30) -> dict[str, Any]:
    """统计周期内任务终态用量（usage_events；主键匹配 user_id，兼容 phone 旧行）。"""
    p = (phone or "").strip()
    d = max(1, min(366, int(days)))
    if not p:
        return {"jobs_terminal": 0, "period_days": d}
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _resolve_user_uuid_from_ref(cur, p)
                cur.execute(
                    """
                    SELECT COUNT(*)::bigint AS n
                    FROM usage_events ue
                    WHERE ue.metric = 'job_terminal'
                      AND ue.created_at >= NOW() - (%s * INTERVAL '1 day')
                      AND (
                        ue.phone = %s
                        OR (%s IS NOT NULL AND ue.user_id = %s::uuid)
                        OR (%s IS NOT NULL AND NULLIF(TRIM(ue.phone), '') = %s::text)
                      )
                    """,
                    (d, p, uid, uid, uid, uid),
                )
                row = cur.fetchone()
                n = int(row["n"] or 0) if row else 0
                return {"jobs_terminal": n, "period_days": d}
    except Exception:
        return {"jobs_terminal": 0, "period_days": d}


def subscription_media_usage_for_phone(phone: str, days: int = 30) -> dict[str, Any]:
    """
    会员页用量条：近 N 天已成功任务聚合。
    - 音频：TTS / 播客类任务的 result.audio_duration_sec 合计换算为分钟。
    - 文字（AI 润色）：播客类任务且 payload.ai_polish 为真的成功次数（与权益矩阵「润色月上限」口径一致）。
    """
    p = (phone or "").strip()
    d = max(1, min(366, int(days)))
    if not p:
        return {"audio_minutes_used": 0.0, "text_polish_used": 0}
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _resolve_user_uuid_from_ref(cur, p)
                if not uid:
                    return {"audio_minutes_used": 0.0, "text_polish_used": 0}
                cur.execute(
                    """
                    SELECT COALESCE(
                             SUM(
                               CASE
                                 WHEN j.result::jsonb ? 'audio_duration_sec'
                                      AND NULLIF(btrim(j.result::jsonb->>'audio_duration_sec'), '') IS NOT NULL
                                   THEN (j.result::jsonb->>'audio_duration_sec')::double precision
                                 ELSE 0::double precision
                               END
                             ),
                             0::double precision
                           )
                           / 60.0 AS audio_minutes
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.deleted_at IS NULL
                      AND j.status = 'succeeded'
                      AND j.job_type = ANY(%s::text[])
                      AND j.completed_at >= NOW() - (%s * INTERVAL '1 day')
                      AND COALESCE(j.created_by, p.user_id) = %s::uuid
                    """,
                    (
                        ["text_to_speech", "tts", "podcast_generate", "podcast"],
                        d,
                        uid,
                    ),
                )
                row_a = cur.fetchone()
                audio_min = float(row_a["audio_minutes"] or 0) if row_a else 0.0

                cur.execute(
                    """
                    SELECT COUNT(*)::bigint AS n
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.deleted_at IS NULL
                      AND j.status = 'succeeded'
                      AND j.job_type = ANY(%s::text[])
                      AND j.completed_at >= NOW() - (%s * INTERVAL '1 day')
                      AND COALESCE(j.created_by, p.user_id) = %s::uuid
                      AND COALESCE((j.payload::jsonb->>'ai_polish')::boolean, false) IS TRUE
                    """,
                    (["podcast_generate", "podcast"], d, uid),
                )
                row_t = cur.fetchone()
                n_polish = int(row_t["n"] or 0) if row_t else 0
                return {"audio_minutes_used": audio_min, "text_polish_used": n_polish}
    except Exception:
        return {"audio_minutes_used": 0.0, "text_polish_used": 0}


def shanghai_calendar_month_start_utc() -> datetime:
    """当前「上海时区」自然月 1 日 00:00 对应的 UTC 时刻（用于套餐内月度克隆次数）。"""
    sh = ZoneInfo("Asia/Shanghai")
    now = datetime.now(sh)
    start_local = datetime(now.year, now.month, 1, tzinfo=sh)
    return start_local.astimezone(timezone.utc)


def count_succeeded_voice_clone_jobs_for_user_uuid(user_uuid: str | None) -> int:
    """
    本月（上海自然月）已成功结束的音色克隆任务数；与套餐内「含 N 次」对齐。
    仅统计终态 succeeded；不含当前进行中任务。
    """
    uid = _normalize_user_uuid(user_uuid)
    if not uid:
        return 0
    try:
        start_utc = shanghai_calendar_month_start_utc()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    SELECT COUNT(*)::bigint AS n
                    FROM jobs j
                    WHERE j.deleted_at IS NULL
                      AND j.status = 'succeeded'
                      AND j.job_type IN ('voice_clone', 'clone_voice')
                      AND j.created_by = %s::uuid
                      AND j.completed_at IS NOT NULL
                      AND j.completed_at >= %s
                    """,
                    (uid, start_utc),
                )
                row = cur.fetchone()
                return int(row["n"] or 0) if row else 0
    except Exception:
        logger.exception("count_succeeded_voice_clone_jobs_for_user_uuid failed")
        return 0


def list_jobs(
    limit: int = 100,
    offset: int = 0,
    status: str | None = None,
    slim: bool = False,
    user_ref: str | None = None,
) -> list[dict[str, Any]]:
    lim = max(1, min(500, int(limit)))
    off = max(0, min(50_000, int(offset)))
    allowed = ("queued", "running", "succeeded", "failed", "cancelled")
    raw = (status or "").strip().lower() if status else ""
    st: str | None = None
    st_any: list[str] | None = None
    if raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        valid = [p for p in parts if p in allowed]
        if len(valid) == 1:
            st = valid[0]
        elif len(valid) > 1:
            st_any = valid
    cols = (
        """
        id, project_id, status, job_type, queue_name, progress,
        created_at, started_at, completed_at, updated_at, created_by,
        LEFT(COALESCE(error_message, ''), 400) AS error_message
        """
        if slim
        else "*"
    )
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            if st:
                cur.execute(
                    f"""
                    SELECT {cols}
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.deleted_at IS NULL
                      AND j.status = %s
                      AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                    ORDER BY j.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (st, user_uuid, user_uuid, lim, off),
                )
            elif st_any:
                cur.execute(
                    f"""
                    SELECT {cols}
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.deleted_at IS NULL
                      AND j.status = ANY(%s)
                      AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                    ORDER BY j.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (st_any, user_uuid, user_uuid, lim, off),
                )
            else:
                cur.execute(
                    f"""
                    SELECT {cols}
                    FROM jobs j
                    LEFT JOIN projects p ON p.id = j.project_id
                    WHERE j.deleted_at IS NULL
                      AND (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                    ORDER BY j.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (user_uuid, user_uuid, lim, off),
                )
            rows = [dict(x) for x in cur.fetchall()]
    if slim:
        for r in rows:
            r["payload"] = {}
            r["result"] = {}
    return rows


def get_project_name(project_id: str) -> str | None:
    if not (project_id or "").strip():
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT name FROM projects WHERE id = %s", (project_id,))
            row = cur.fetchone()
            return str(row["name"]) if row else None


def list_job_artifacts(job_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, artifact_type, object_key, mime_type, created_at
                FROM artifacts
                WHERE job_id = %s
                ORDER BY id ASC
                """,
                (job_id,),
            )
            return [dict(x) for x in cur.fetchall()]


def get_job_artifact(job_id: str, artifact_id: str) -> dict[str, Any] | None:
    aid = (artifact_id or "").strip()
    if not aid:
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, job_id, artifact_type, object_key, mime_type, created_at
                FROM artifacts
                WHERE job_id = %s AND id::text = %s
                """,
                (job_id, aid),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def ensure_usage_events_user_id_schema() -> None:
    """运行时补齐 usage_events.user_id（与 022 迁移一致）；全进程仅执行一次 ALTER。"""
    global _usage_events_user_id_schema_ready
    if _usage_events_user_id_schema_ready:
        return
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    ALTER TABLE usage_events
                    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_usage_events_user_id_created
                    ON usage_events(user_id, created_at DESC)
                    """
                )
            conn.commit()
        _usage_events_user_id_schema_ready = True
    except Exception:
        logger.exception("ensure_usage_events_user_id_schema 失败")


def record_usage_event(
    job_id: str | None,
    phone: str | None,
    job_type: str,
    metric: str,
    status: str | None = None,
    quantity: float = 1,
    meta: dict[str, Any] | None = None,
    *,
    user_id: str | None = None,
) -> None:
    """写入用量事件表；user_id 为 users.id(UUID)，phone 仅作展示/兼容旧统计。"""
    ensure_usage_events_user_id_schema()
    uid = _normalize_user_uuid(user_id)
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    INSERT INTO usage_events (job_id, phone, user_id, job_type, metric, status, quantity, meta)
                    VALUES (%s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (job_id, phone, uid, job_type, metric, status, quantity, json.dumps(meta or {})),
                )
                conn.commit()
    except Exception:
        logger.warning("usage_events 写入失败 job_id=%s job_type=%s", job_id, job_type, exc_info=True)


def _usage_event_phone_for_job(row: dict[str, Any]) -> str | None:
    """由 jobs.created_by（UUID）解析展示用手机号；用量主键用 user_id。"""
    cb = row.get("created_by")
    if cb is None:
        return None
    s = str(cb).strip()
    if not s:
        return None
    try:
        uuid.UUID(s)
    except (ValueError, TypeError, AttributeError):
        return s
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT phone FROM users WHERE id = %s::uuid LIMIT 1", (s,))
            r = cur.fetchone()
            p = (r or {}).get("phone")
            return str(p).strip() if p else None


def _try_record_usage_on_terminal(job_id: str, status: str) -> None:
    if status not in ("succeeded", "failed", "cancelled"):
        return
    row = get_job(job_id)
    if not row:
        return
    phone = _usage_event_phone_for_job(row)
    cb = row.get("created_by")
    job_user_id = _normalize_user_uuid(str(cb) if cb is not None else "")
    jt = str(row.get("job_type") or "")
    meta = build_usage_event_meta(row, status)
    if phone is None and row.get("created_by"):
        meta = {**meta, "created_by_uuid": str(row.get("created_by"))}
    record_usage_event(
        job_id,
        phone,
        jt,
        "job_terminal",
        status=status,
        quantity=1,
        meta=meta,
        user_id=job_user_id,
    )


def search_global(query: str, limit: int = 40, user_ref: str | None = None) -> dict[str, Any]:
    q = (query or "").strip()
    if len(q) < 2:
        return {"notes": [], "jobs": []}
    lim = max(1, min(80, int(limit)))
    pattern = f"%{q}%"
    notes_out: list[dict[str, Any]] = []
    jobs_out: list[dict[str, Any]] = []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_or_none(cur, user_ref)
            cur.execute(
                """
                SELECT i.id::text AS id,
                       i.metadata->>'title' AS title,
                       i.metadata->>'notebook' AS notebook,
                       LEFT(COALESCE(i.content_text, ''), 320) AS snippet,
                       i.created_at
                FROM inputs i
                JOIN projects p ON p.id = i.project_id
                WHERE i.input_type IN ('note_text', 'note_file')
                  AND i.deleted_at IS NULL
                  AND (%s::uuid IS NULL OR p.user_id = %s::uuid)
                  AND (
                    i.content_text ILIKE %s
                    OR COALESCE(i.metadata->>'title', '') ILIKE %s
                  )
                ORDER BY i.created_at DESC
                LIMIT %s
                """,
                (user_uuid, user_uuid, pattern, pattern, lim),
            )
            notes_out = [dict(x) for x in cur.fetchall()]
            cur.execute(
                """
                SELECT j.id::text AS id, j.job_type, j.status,
                       LEFT(
                         COALESCE(j.result::text, '') || ' ' || COALESCE(j.payload::text, '') || ' ' || COALESCE(j.error_message, ''),
                         400
                       ) AS snippet,
                       j.created_at
                FROM jobs j
                LEFT JOIN projects p ON p.id = j.project_id
                WHERE (%s::uuid IS NULL OR COALESCE(j.created_by, p.user_id) = %s::uuid)
                  AND (
                    j.job_type ILIKE %s
                    OR j.result::text ILIKE %s
                    OR j.payload::text ILIKE %s
                    OR COALESCE(j.error_message, '') ILIKE %s
                  )
                ORDER BY j.created_at DESC
                LIMIT %s
                """,
                (user_uuid, user_uuid, pattern, pattern, pattern, pattern, lim),
            )
            jobs_out = [dict(x) for x in cur.fetchall()]
    return {"notes": notes_out, "jobs": jobs_out}


def _admin_usage_events_summary_rows(
    cur,
    *,
    date_from: date,
    date_to: date,
) -> list[dict[str, Any]]:
    df = date_from if date_from <= date_to else date_to
    dt = date_to if date_from <= date_to else date_from
    cur.execute(
        """
        SELECT job_type,
               COUNT(*)::bigint AS events,
               COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
               COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
               COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled,
               COUNT(DISTINCT job_id) FILTER (WHERE job_id IS NOT NULL)::bigint AS distinct_jobs,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'llm_cost_cny'), '')::numeric),
                 0::numeric
               ) AS llm_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'tts_cost_cny'), '')::numeric),
                 0::numeric
               ) AS tts_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'image_cost_cny'), '')::numeric),
                 0::numeric
               ) AS image_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric),
                 0::numeric
               ) AS cost_total_cny
        FROM usage_events
        WHERE metric = 'job_terminal'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::date >= %s
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::date <= %s
        GROUP BY job_type
        ORDER BY events DESC
        """,
        (df, dt),
    )
    return [dict(x) for x in cur.fetchall()]


def _admin_usage_events_summary_rows_days(cur, days: int) -> list[dict[str, Any]]:
    d = max(1, min(365, int(days)))
    cur.execute(
        """
        SELECT job_type,
               COUNT(*)::bigint AS events,
               COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
               COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
               COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled,
               COUNT(DISTINCT job_id) FILTER (WHERE job_id IS NOT NULL)::bigint AS distinct_jobs,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'llm_cost_cny'), '')::numeric),
                 0::numeric
               ) AS llm_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'tts_cost_cny'), '')::numeric),
                 0::numeric
               ) AS tts_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'image_cost_cny'), '')::numeric),
                 0::numeric
               ) AS image_cost_cny,
               COALESCE(
                 SUM(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric),
                 0::numeric
               ) AS cost_total_cny
        FROM usage_events
        WHERE metric = 'job_terminal'
          AND created_at >= NOW() - make_interval(days => %s)
        GROUP BY job_type
        ORDER BY events DESC
        """,
        (d,),
    )
    return [dict(x) for x in cur.fetchall()]


def _admin_jobs_terminal_summary_rows(
    cur,
    *,
    date_from: date,
    date_to: date,
) -> list[dict[str, Any]]:
    """usage_events 无数据时的回退：按 jobs 终态统计（分项 CNY 为 0，前端用目录单价估算）。"""
    df = date_from if date_from <= date_to else date_to
    dt = date_to if date_from <= date_to else date_from
    cur.execute(
        """
        SELECT job_type,
               COUNT(*)::bigint AS events,
               COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
               COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
               COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled,
               COUNT(DISTINCT id)::bigint AS distinct_jobs,
               0::numeric AS llm_cost_cny,
               0::numeric AS tts_cost_cny,
               0::numeric AS image_cost_cny,
               0::numeric AS cost_total_cny
        FROM jobs
        WHERE status IN ('succeeded', 'failed', 'cancelled')
          AND completed_at IS NOT NULL
          AND deleted_at IS NULL
          AND (completed_at AT TIME ZONE 'Asia/Shanghai')::date >= %s
          AND (completed_at AT TIME ZONE 'Asia/Shanghai')::date <= %s
        GROUP BY job_type
        ORDER BY events DESC
        """,
        (df, dt),
    )
    return [dict(x) for x in cur.fetchall()]


def _admin_jobs_terminal_summary_rows_days(cur, days: int) -> list[dict[str, Any]]:
    d = max(1, min(365, int(days)))
    cur.execute(
        """
        SELECT job_type,
               COUNT(*)::bigint AS events,
               COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
               COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
               COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled,
               COUNT(DISTINCT id)::bigint AS distinct_jobs,
               0::numeric AS llm_cost_cny,
               0::numeric AS tts_cost_cny,
               0::numeric AS image_cost_cny,
               0::numeric AS cost_total_cny
        FROM jobs
        WHERE status IN ('succeeded', 'failed', 'cancelled')
          AND completed_at IS NOT NULL
          AND deleted_at IS NULL
          AND completed_at >= NOW() - make_interval(days => %s)
        GROUP BY job_type
        ORDER BY events DESC
        """,
        (d,),
    )
    return [dict(x) for x in cur.fetchall()]


def admin_usage_summary(
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """
    聚合 usage_events；若无事件行则回退为 jobs 终态统计（兼容未跑 002 迁移或写入失败）。
    指定 date_from + date_to 时按 Asia/Shanghai 日历日（含首尾）筛选；
    否则按近 days 天滚动窗口（与 NOW() 对齐）。

    Returns:
        {"rows": [...], "source": "usage_events" | "jobs_fallback"}
    """
    rows: list[dict[str, Any]] = []
    source = "usage_events"
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                if date_from is not None and date_to is not None:
                    df = date_from if date_from <= date_to else date_to
                    dt = date_to if date_from <= date_to else date_from
                    rows = _admin_usage_events_summary_rows(cur, date_from=df, date_to=dt)
                else:
                    d = max(1, min(365, int(days if days is not None else 30)))
                    rows = _admin_usage_events_summary_rows_days(cur, d)
    except Exception:
        logger.exception("usage_events 聚合失败，将尝试 jobs 回退")
        rows = []

    if not rows:
        try:
            with get_conn() as conn:
                with get_cursor(conn) as cur:
                    if date_from is not None and date_to is not None:
                        df = date_from if date_from <= date_to else date_to
                        dt = date_to if date_from <= date_to else date_from
                        rows = _admin_jobs_terminal_summary_rows(cur, date_from=df, date_to=dt)
                    else:
                        d = max(1, min(365, int(days if days is not None else 30)))
                        rows = _admin_jobs_terminal_summary_rows_days(cur, d)
            if rows:
                source = "jobs_fallback"
        except Exception:
            logger.exception("jobs 用量回退聚合失败")
            rows = []
    return {"rows": rows, "source": source}


def _safe_float(raw: Any) -> float:
    try:
        if raw is None:
            return 0.0
        return float(raw)
    except Exception:
        return 0.0


def _safe_int(raw: Any) -> int:
    try:
        if raw is None:
            return 0
        return int(raw)
    except Exception:
        return 0


def _admin_resolve_date_window(
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[datetime, datetime]:
    if date_from is not None and date_to is not None:
        df = date_from if date_from <= date_to else date_to
        dt = date_to if date_from <= date_to else date_from
        start_dt = datetime(df.year, df.month, df.day, 0, 0, 0, tzinfo=timezone.utc)
        end_dt = datetime(dt.year, dt.month, dt.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        return start_dt, end_dt
    d = max(1, min(365, int(days if days is not None else 30)))
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=d)
    return start_dt, end_dt


def admin_usage_dashboard(
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """
    管理端看板聚合（时间范围可选）：
    - overview: 核心 KPI
    - by_job_type: 功能调用分布
    - by_input_type: 输入来源分布（text/url/notes/file/other）
    - by_day: 趋势
    - top_users: 高活跃用户
    """
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    out: dict[str, Any] = {
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "overview": {},
        "by_job_type": [],
        "by_input_type": [],
        "by_day": [],
        "top_users": [],
        "source": "usage_events",
    }
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::bigint AS total_events,
                  COUNT(*) FILTER (WHERE ue.status = 'succeeded')::bigint AS succeeded_events,
                  COUNT(*) FILTER (WHERE ue.status = 'failed')::bigint AS failed_events,
                  COUNT(*) FILTER (WHERE ue.status = 'cancelled')::bigint AS cancelled_events,
                  COUNT(DISTINCT NULLIF(TRIM(COALESCE(ue.user_id::text, ue.phone)), ''))::bigint AS active_users,
                  COUNT(DISTINCT ue.job_id) FILTER (WHERE ue.job_id IS NOT NULL)::bigint AS distinct_jobs,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'llm_cost_cny'), '')::numeric), 0::numeric) AS llm_cost_cny,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'tts_cost_cny'), '')::numeric), 0::numeric) AS tts_cost_cny,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'image_cost_cny'), '')::numeric), 0::numeric) AS image_cost_cny,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny
                FROM usage_events ue
                WHERE ue.metric = 'job_terminal'
                  AND ue.created_at >= %s
                  AND ue.created_at <= %s
                """,
                (start_dt, end_dt),
            )
            row = dict(cur.fetchone() or {})
            total_events = _safe_int(row.get("total_events"))
            succeeded_events = _safe_int(row.get("succeeded_events"))
            failed_events = _safe_int(row.get("failed_events"))
            cancelled_events = _safe_int(row.get("cancelled_events"))
            out["overview"] = {
                "total_events": total_events,
                "succeeded_events": succeeded_events,
                "failed_events": failed_events,
                "cancelled_events": cancelled_events,
                "success_rate": round((succeeded_events / total_events), 4) if total_events else 0.0,
                "active_users": _safe_int(row.get("active_users")),
                "distinct_jobs": _safe_int(row.get("distinct_jobs")),
                "llm_cost_cny": _safe_float(row.get("llm_cost_cny")),
                "tts_cost_cny": _safe_float(row.get("tts_cost_cny")),
                "image_cost_cny": _safe_float(row.get("image_cost_cny")),
                "cost_total_cny": _safe_float(row.get("cost_total_cny")),
            }

            cur.execute(
                """
                SELECT
                  ue.job_type,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE ue.status = 'succeeded')::bigint AS succeeded,
                  COUNT(*) FILTER (WHERE ue.status = 'failed')::bigint AS failed,
                  COUNT(DISTINCT NULLIF(TRIM(COALESCE(ue.user_id::text, ue.phone)), ''))::bigint AS users,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny
                FROM usage_events ue
                WHERE ue.metric = 'job_terminal'
                  AND ue.created_at >= %s
                  AND ue.created_at <= %s
                GROUP BY ue.job_type
                ORDER BY events DESC
                """,
                (start_dt, end_dt),
            )
            out["by_job_type"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  input_type,
                  COUNT(*)::bigint AS events
                FROM (
                  SELECT
                    CASE
                      WHEN COALESCE(j.payload->>'source_url', j.payload->>'url', '') <> '' THEN 'url'
                      WHEN jsonb_typeof(j.payload->'selected_note_ids') = 'array'
                           AND jsonb_array_length(j.payload->'selected_note_ids') > 0 THEN 'notes'
                      WHEN COALESCE(j.payload->>'text', '') <> '' THEN 'text'
                      WHEN COALESCE(j.payload->>'file_object_key', j.payload->>'file_url', '') <> '' THEN 'file'
                      ELSE 'other'
                    END AS input_type
                  FROM usage_events ue
                  LEFT JOIN jobs j ON j.id = ue.job_id
                  WHERE ue.metric = 'job_terminal'
                    AND ue.created_at >= %s
                    AND ue.created_at <= %s
                ) t
                GROUP BY input_type
                ORDER BY events DESC
                """,
                (start_dt, end_dt),
            )
            out["by_input_type"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  (ue.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE ue.status = 'succeeded')::bigint AS succeeded,
                  COUNT(DISTINCT NULLIF(TRIM(COALESCE(ue.user_id::text, ue.phone)), ''))::bigint AS users,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny
                FROM usage_events ue
                WHERE ue.metric = 'job_terminal'
                  AND ue.created_at >= %s
                  AND ue.created_at <= %s
                GROUP BY day
                ORDER BY day ASC
                """,
                (start_dt, end_dt),
            )
            out["by_day"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  COALESCE(ue.user_id::text, NULLIF(TRIM(ue.phone), ''), '(unknown)') AS user_key,
                  MAX(ue.user_id::text) AS user_id,
                  MAX(COALESCE(
                    NULLIF(TRIM(u.phone), ''),
                    NULLIF(TRIM(ue.phone), ''),
                    ue.user_id::text
                  )) AS phone,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE ue.status = 'succeeded')::bigint AS succeeded,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny,
                  MAX(ue.created_at) AS last_event_at
                FROM usage_events ue
                LEFT JOIN users u ON u.id = ue.user_id
                WHERE ue.metric = 'job_terminal'
                  AND ue.created_at >= %s
                  AND ue.created_at <= %s
                GROUP BY COALESCE(ue.user_id::text, NULLIF(TRIM(ue.phone), ''), '(unknown)')
                ORDER BY events DESC, last_event_at DESC
                LIMIT 20
                """,
                (start_dt, end_dt),
            )
            out["top_users"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT COUNT(*)::bigint AS login_count,
                       COUNT(DISTINCT NULLIF(TRIM(COALESCE(user_id::text, phone)), ''))::bigint AS login_users
                FROM usage_events
                WHERE metric = 'auth_login'
                  AND created_at >= %s
                  AND created_at <= %s
                """,
                (start_dt, end_dt),
            )
            login_row = dict(cur.fetchone() or {})
            out["overview"]["login_count"] = _safe_int(login_row.get("login_count"))
            out["overview"]["login_users"] = _safe_int(login_row.get("login_users"))
    return out


def admin_orders_analytics(
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """
    管理端订单分析（payment_orders，按 created_at 落入时间窗）：
    - overview: 下单/成交/在途/失败笔数，成交 GMV、退款、净额、付费人数
    - by_status / by_provider / by_product: 分布
    - by_day: 趋势
    - recent_orders: 最近订单明细（限额）
    """
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    out: dict[str, Any] = {
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "overview": {},
        "by_status": [],
        "by_provider": [],
        "by_product": [],
        "by_day": [],
        "recent_orders": [],
    }
    ensure_payment_orders_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::bigint AS total_orders,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                  )::bigint AS settled_orders,
                  COUNT(*) FILTER (WHERE lower(COALESCE(status, '')) = 'failed')::bigint AS failed_orders,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(status, '')) IN ('created', 'pending_payment', 'authorized', 'unknown')
                  )::bigint AS open_orders,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                        THEN COALESCE(paid_cents, payable_cents, amount_cents)
                        ELSE 0
                      END
                    ),
                    0
                  )::bigint AS gross_settled_cents,
                  COALESCE(
                    SUM(COALESCE(refunded_amount_cents, 0)) FILTER (
                      WHERE lower(COALESCE(status, '')) IN ('paid', 'partially_refunded', 'refunded')
                    ),
                    0
                  )::bigint AS refunded_cents,
                  COUNT(DISTINCT phone) FILTER (
                    WHERE lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                  )::bigint AS payer_phones
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                """,
                (start_dt, end_dt),
            )
            ov = dict(cur.fetchone() or {})
            gross = int(ov.get("gross_settled_cents") or 0)
            ref = int(ov.get("refunded_cents") or 0)
            settled = int(ov.get("settled_orders") or 0)
            net = max(0, gross - ref)
            out["overview"] = {
                "total_orders": _safe_int(ov.get("total_orders")),
                "settled_orders": settled,
                "failed_orders": _safe_int(ov.get("failed_orders")),
                "open_orders": _safe_int(ov.get("open_orders")),
                "gross_settled_cents": gross,
                "refunded_cents": ref,
                "net_revenue_cents": net,
                "payer_phones": _safe_int(ov.get("payer_phones")),
                "aov_net_cents": int(round(net / settled)) if settled else 0,
            }

            cur.execute(
                """
                SELECT
                  lower(COALESCE(status, 'unknown')) AS status,
                  COUNT(*)::bigint AS orders,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                        THEN COALESCE(paid_cents, payable_cents, amount_cents)
                        ELSE 0
                      END
                    ),
                    0
                  )::bigint AS settled_amount_cents
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                GROUP BY lower(COALESCE(status, 'unknown'))
                ORDER BY orders DESC
                """,
                (start_dt, end_dt),
            )
            out["by_status"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  COALESCE(NULLIF(TRIM(provider), ''), 'unknown') AS provider,
                  COUNT(*)::bigint AS orders,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                        THEN COALESCE(paid_cents, payable_cents, amount_cents)
                        ELSE 0
                      END
                    ),
                    0
                  )::bigint AS settled_amount_cents
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                GROUP BY COALESCE(NULLIF(TRIM(provider), ''), 'unknown')
                ORDER BY orders DESC
                """,
                (start_dt, end_dt),
            )
            out["by_provider"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  COALESCE(NULLIF(TRIM(tier), ''), 'unknown') AS tier,
                  COALESCE(NULLIF(TRIM(billing_cycle), ''), '-') AS billing_cycle,
                  COUNT(*)::bigint AS orders,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                        THEN COALESCE(paid_cents, payable_cents, amount_cents)
                        ELSE 0
                      END
                    ),
                    0
                  )::bigint AS settled_amount_cents
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                GROUP BY 1, 2
                ORDER BY orders DESC
                """,
                (start_dt, end_dt),
            )
            out["by_product"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
                  COUNT(*)::bigint AS orders,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                  )::bigint AS settled_orders,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN lower(COALESCE(status, '')) IN ('paid', 'partially_refunded')
                        THEN COALESCE(paid_cents, payable_cents, amount_cents)
                        ELSE 0
                      END
                    ),
                    0
                  )::bigint AS gross_settled_cents
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                GROUP BY day
                ORDER BY day ASC
                """,
                (start_dt, end_dt),
            )
            out["by_day"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  event_id,
                  COALESCE(NULLIF(TRIM(phone), ''), '—') AS phone,
                  COALESCE(NULLIF(TRIM(tier), ''), 'unknown') AS tier,
                  billing_cycle,
                  lower(COALESCE(status, 'unknown')) AS status,
                  amount_cents,
                  COALESCE(paid_cents, payable_cents, amount_cents) AS effective_amount_cents,
                  COALESCE(refunded_amount_cents, 0)::bigint AS refunded_amount_cents,
                  COALESCE(NULLIF(TRIM(provider), ''), 'unknown') AS provider,
                  COALESCE(NULLIF(TRIM(channel), ''), 'unknown') AS channel,
                  created_at
                FROM payment_orders
                WHERE created_at >= %s
                  AND created_at <= %s
                ORDER BY created_at DESC, id DESC
                LIMIT 40
                """,
                (start_dt, end_dt),
            )
            recent = [dict(x) for x in cur.fetchall()]
            for r in recent:
                ca = r.get("created_at")
                if hasattr(ca, "isoformat"):
                    r["created_at"] = ca.isoformat()
            out["recent_orders"] = recent
    return out


def admin_usage_users(
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    lim = max(1, min(200, int(limit)))
    rows: list[dict[str, Any]] = []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                  COALESCE(ue.user_id::text, NULLIF(TRIM(ue.phone), ''), '(unknown)') AS user_key,
                  MAX(ue.user_id::text) AS user_id,
                  MAX(COALESCE(
                    NULLIF(TRIM(u.phone), ''),
                    NULLIF(TRIM(ue.phone), ''),
                    ue.user_id::text
                  )) AS phone,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE ue.status = 'succeeded')::bigint AS succeeded,
                  COUNT(*) FILTER (WHERE ue.status = 'failed')::bigint AS failed,
                  COUNT(DISTINCT ue.job_type)::bigint AS feature_kinds,
                  COUNT(DISTINCT ue.job_id) FILTER (WHERE ue.job_id IS NOT NULL)::bigint AS works,
                  COALESCE(SUM(NULLIF(TRIM(ue.meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny,
                  MAX(ue.created_at) AS last_event_at
                FROM usage_events ue
                LEFT JOIN users u ON u.id = ue.user_id
                WHERE ue.metric = 'job_terminal'
                  AND ue.created_at >= %s
                  AND ue.created_at <= %s
                GROUP BY COALESCE(ue.user_id::text, NULLIF(TRIM(ue.phone), ''), '(unknown)')
                ORDER BY events DESC, last_event_at DESC
                LIMIT %s
                """,
                (start_dt, end_dt, lim),
            )
            rows = [dict(x) for x in cur.fetchall()]
    return {
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "rows": rows,
    }


def admin_usage_user_detail(
    user_ref: str,
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """user_ref 可为 users.id(UUID)、手机号或登录标识（与列表行 user_key 一致）。"""
    p = (user_ref or "").strip()
    if not p:
        return {
            "phone": "",
            "user_id": "",
            "user_key": "",
            "window": {},
            "overview": {},
            "by_feature": [],
            "recent_events": [],
        }
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    out: dict[str, Any] = {
        "phone": p,
        "user_id": "",
        "user_key": p,
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "overview": {},
        "by_feature": [],
        "recent_events": [],
    }
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            uid_resolved = _resolve_user_uuid_from_ref(cur, p)
            uid_literal = _normalize_user_uuid(p)
            filter_uid = uid_resolved or uid_literal
            cur.execute(
                """
                SELECT
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
                  COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                  COUNT(DISTINCT job_id) FILTER (WHERE job_id IS NOT NULL)::bigint AS works,
                  COALESCE(SUM(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny,
                  MAX(created_at) AS last_event_at
                FROM usage_events
                WHERE metric = 'job_terminal'
                  AND created_at >= %s
                  AND created_at <= %s
                  AND (
                    phone = %s
                    OR (%s IS NOT NULL AND user_id = %s::uuid)
                  )
                """,
                (start_dt, end_dt, p, filter_uid, filter_uid),
            )
            out["overview"] = dict(cur.fetchone() or {})

            cur.execute(
                """
                SELECT
                  job_type,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
                  COALESCE(SUM(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny
                FROM usage_events
                WHERE metric = 'job_terminal'
                  AND created_at >= %s
                  AND created_at <= %s
                  AND (
                    phone = %s
                    OR (%s IS NOT NULL AND user_id = %s::uuid)
                  )
                GROUP BY job_type
                ORDER BY events DESC
                """,
                (start_dt, end_dt, p, filter_uid, filter_uid),
            )
            out["by_feature"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  created_at,
                  job_type,
                  status,
                  COALESCE(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric, 0::numeric) AS cost_total_cny,
                  job_id
                FROM usage_events
                WHERE metric = 'job_terminal'
                  AND created_at >= %s
                  AND created_at <= %s
                  AND (
                    phone = %s
                    OR (%s IS NOT NULL AND user_id = %s::uuid)
                  )
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (start_dt, end_dt, p, filter_uid, filter_uid),
            )
            out["recent_events"] = [dict(x) for x in cur.fetchall()]

            effective_uid = str(uid_resolved or uid_literal or "").strip()
            out["user_id"] = effective_uid
            if effective_uid:
                cur.execute(
                    "SELECT phone FROM users WHERE id = %s::uuid LIMIT 1",
                    (effective_uid,),
                )
                ur = cur.fetchone()
                ph = (ur or {}).get("phone")
                if ph and str(ph).strip():
                    out["phone"] = str(ph).strip()
    return out


def admin_works_analysis(
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    out: dict[str, Any] = {
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "overview": {},
        "by_type": [],
        "by_day": [],
    }
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::bigint AS total_jobs,
                  COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded_jobs,
                  COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_jobs,
                  COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled_jobs,
                  COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))), 0)::numeric AS avg_duration_sec,
                  COALESCE(
                    PERCENTILE_CONT(0.95) WITHIN GROUP (
                      ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
                    ),
                    0
                  )::numeric AS p95_duration_sec
                FROM jobs
                WHERE completed_at IS NOT NULL
                  AND completed_at >= %s
                  AND completed_at <= %s
                """,
                (start_dt, end_dt),
            )
            out["overview"] = dict(cur.fetchone() or {})

            cur.execute(
                """
                SELECT
                  job_type,
                  COUNT(*)::bigint AS jobs,
                  COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
                  COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                  COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled,
                  COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))), 0)::numeric AS avg_duration_sec
                FROM jobs
                WHERE completed_at IS NOT NULL
                  AND completed_at >= %s
                  AND completed_at <= %s
                GROUP BY job_type
                ORDER BY jobs DESC
                """,
                (start_dt, end_dt),
            )
            out["by_type"] = [dict(x) for x in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  (completed_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
                  COUNT(*)::bigint AS jobs,
                  COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
                  COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))), 0)::numeric AS avg_duration_sec
                FROM jobs
                WHERE completed_at IS NOT NULL
                  AND completed_at >= %s
                  AND completed_at <= %s
                GROUP BY day
                ORDER BY day ASC
                """,
                (start_dt, end_dt),
            )
            out["by_day"] = [dict(x) for x in cur.fetchall()]
    return out


def admin_usage_alerts(
    *,
    days: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    start_dt, end_dt = _admin_resolve_date_window(days=days, date_from=date_from, date_to=date_to)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT
                  (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
                  COUNT(*)::bigint AS events,
                  COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                  COALESCE(SUM(NULLIF(TRIM(meta->>'cost_total_cny'), '')::numeric), 0::numeric) AS cost_total_cny
                FROM usage_events
                WHERE metric = 'job_terminal'
                  AND created_at >= %s
                  AND created_at <= %s
                GROUP BY day
                ORDER BY day ASC
                """,
                (start_dt, end_dt),
            )
            days_rows = [dict(x) for x in cur.fetchall()]
    fail_rates: list[float] = []
    costs: list[float] = []
    for r in days_rows:
        events = _safe_int(r.get("events"))
        failed = _safe_int(r.get("failed"))
        fr = (failed / events) if events else 0.0
        fail_rates.append(fr)
        costs.append(_safe_float(r.get("cost_total_cny")))
        r["fail_rate"] = round(fr, 4)
    baseline_fail = (sum(fail_rates) / len(fail_rates)) if fail_rates else 0.0
    baseline_cost = (sum(costs) / len(costs)) if costs else 0.0
    alerts: list[dict[str, Any]] = []
    for r in days_rows:
        day = str(r.get("day") or "")
        fr = float(r.get("fail_rate") or 0.0)
        c = _safe_float(r.get("cost_total_cny"))
        if fr >= max(0.25, baseline_fail * 1.8):
            alerts.append(
                {
                    "severity": "high",
                    "type": "failure_rate_spike",
                    "day": day,
                    "message": f"失败率偏高：{round(fr * 100, 1)}%",
                    "value": fr,
                    "baseline": round(baseline_fail, 4),
                }
            )
        if c >= max(20.0, baseline_cost * 1.8):
            alerts.append(
                {
                    "severity": "medium",
                    "type": "cost_spike",
                    "day": day,
                    "message": f"成本偏高：¥{c:.2f}",
                    "value": c,
                    "baseline": round(baseline_cost, 4),
                }
            )
    return {
        "window": {"start_at": start_dt.isoformat(), "end_at": end_dt.isoformat()},
        "baseline": {"fail_rate": round(baseline_fail, 4), "cost_total_cny": round(baseline_cost, 4)},
        "days": days_rows,
        "alerts": alerts,
    }


def admin_subscription_events(
    *,
    phone: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    p = (phone or "").strip()
    et = (event_type or "").strip().lower()
    src = (source or "").strip().lower()
    lim = max(1, min(500, int(limit)))
    off = max(0, int(offset))

    where: list[str] = []
    params: list[Any] = []
    if p:
        where.append("se.phone = %s")
        params.append(p)
    if et:
        where.append("se.event_type = %s")
        params.append(et)
    if src:
        where.append("se.source = %s")
        params.append(src)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*)::bigint AS n FROM subscription_events se {where_sql}", tuple(params))
            total_row = cur.fetchone() or {}
            total = int(total_row.get("n") or 0)

            cur.execute(
                f"""
                SELECT
                  se.id,
                  se.user_id::text AS user_id,
                  se.phone,
                  se.tier,
                  se.event_type,
                  se.billing_cycle,
                  se.effective_at,
                  se.expires_at,
                  se.order_event_id,
                  se.trace_id,
                  se.request_id,
                  se.source,
                  se.actor_phone,
                  se.meta,
                  se.created_at,
                  po.event_id AS order_event_id_joined,
                  po.trace_id AS order_trace_id,
                  po.request_id AS order_request_id,
                  po.status AS order_status,
                  po.amount_cents AS order_amount_cents,
                  po.provider AS order_provider,
                  po.tier AS order_tier,
                  po.billing_cycle AS order_billing_cycle,
                  po.created_at AS order_created_at
                FROM subscription_events se
                LEFT JOIN payment_orders po
                  ON po.event_id = se.order_event_id
                {where_sql}
                ORDER BY se.created_at DESC, se.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [lim, off]),
            )
            rows = [dict(x) for x in cur.fetchall()]

    events: list[dict[str, Any]] = []
    for r in rows:
        order: dict[str, Any] | None = None
        if r.get("order_event_id_joined"):
            order = {
                "event_id": r.get("order_event_id_joined"),
                "trace_id": r.get("order_trace_id"),
                "request_id": r.get("order_request_id"),
                "status": r.get("order_status"),
                "amount_cents": int(r.get("order_amount_cents") or 0),
                "provider": r.get("order_provider"),
                "tier": r.get("order_tier"),
                "billing_cycle": r.get("order_billing_cycle"),
                "created_at": r.get("order_created_at"),
            }
        events.append(
            {
                "id": int(r.get("id") or 0),
                "user_id": r.get("user_id"),
                "phone": r.get("phone"),
                "tier": r.get("tier"),
                "event_type": r.get("event_type"),
                "billing_cycle": r.get("billing_cycle"),
                "effective_at": r.get("effective_at"),
                "expires_at": r.get("expires_at"),
                "order_event_id": r.get("order_event_id"),
                "trace_id": r.get("trace_id"),
                "request_id": r.get("request_id"),
                "source": r.get("source"),
                "actor_phone": r.get("actor_phone"),
                "meta": r.get("meta") if isinstance(r.get("meta"), dict) else {},
                "created_at": r.get("created_at"),
                "order": order,
            }
        )

    return {
        "total": total,
        "limit": lim,
        "offset": off,
        "events": events,
    }


def admin_data_consistency_report(*, phone: str | None = None, limit: int = 200) -> dict[str, Any]:
    p = (phone or "").strip()
    lim = max(1, min(1000, int(limit)))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            where = "WHERE po.phone = %s" if p else ""
            args: tuple[Any, ...] = (p, lim) if p else (lim,)
            cur.execute(
                f"""
                SELECT
                  po.event_id,
                  po.phone AS order_phone,
                  u.phone AS user_phone,
                  po.user_id::text AS order_user_id,
                  po.status AS order_status,
                  po.currency AS order_currency,
                  po.amount_cents,
                  po.refunded_amount_cents,
                  po.provider,
                  po.created_at
                FROM payment_orders po
                LEFT JOIN users u ON u.id = po.user_id
                {where}
                ORDER BY po.created_at DESC
                LIMIT %s
                """,
                args,
            )
            rows = [dict(x) for x in cur.fetchall() or []]
            event_ids = [str(x.get("event_id") or "") for x in rows if str(x.get("event_id") or "").strip()]
            refund_sum_by_event: dict[str, int] = {}
            if event_ids:
                cur.execute(
                    """
                    SELECT order_event_id, COALESCE(SUM(refunded_amount_cents), 0)::bigint AS refunded_sum
                    FROM payment_refunds
                    WHERE order_event_id = ANY(%s)
                    GROUP BY order_event_id
                    """,
                    (event_ids,),
                )
                for rr in cur.fetchall() or []:
                    k = str(rr.get("order_event_id") or "").strip()
                    if not k:
                        continue
                    refund_sum_by_event[k] = int(rr.get("refunded_sum") or 0)

    issues: list[dict[str, Any]] = []
    metrics = {
        "phone_mismatch_with_user": 0,
        "invalid_order_status": 0,
        "invalid_currency": 0,
        "refund_amount_mismatch": 0,
        "refunded_status_without_refund_detail": 0,
        "refund_exceeds_order_amount": 0,
    }
    for r in rows:
        status = str(r.get("order_status") or "")
        currency = str(r.get("order_currency") or "")
        event_id = str(r.get("event_id") or "").strip()
        amount_cents = int(r.get("amount_cents") or 0)
        order_refunded_amount = int(r.get("refunded_amount_cents") or 0)
        refund_sum = int(refund_sum_by_event.get(event_id, 0))
        if r.get("order_user_id") and r.get("user_phone") and r.get("order_phone") != r.get("user_phone"):
            metrics["phone_mismatch_with_user"] += 1
            issues.append(
                {
                    "event_id": r.get("event_id"),
                    "issue": "phone_mismatch_with_user",
                    "order_phone": r.get("order_phone"),
                    "user_phone": r.get("user_phone"),
                }
            )
        if status not in {"created", "paid", "failed", "refunded", "cancelled", "unknown"}:
            metrics["invalid_order_status"] += 1
            issues.append(
                {
                    "event_id": r.get("event_id"),
                    "issue": "invalid_order_status",
                    "status": status,
                }
            )
        if currency not in {"CNY", "USD", "EUR", "JPY", "HKD", "SGD"}:
            metrics["invalid_currency"] += 1
            issues.append(
                {
                    "event_id": r.get("event_id"),
                    "issue": "invalid_currency",
                    "currency": currency,
                }
            )
        if status == "refunded" and refund_sum <= 0:
            metrics["refunded_status_without_refund_detail"] += 1
            issues.append(
                {
                    "event_id": event_id,
                    "issue": "refunded_status_without_refund_detail",
                    "status": status,
                }
            )
        if order_refunded_amount != refund_sum:
            metrics["refund_amount_mismatch"] += 1
            issues.append(
                {
                    "event_id": event_id,
                    "issue": "refund_amount_mismatch",
                    "order_refunded_amount_cents": order_refunded_amount,
                    "refund_detail_sum_cents": refund_sum,
                    "order_amount_cents": amount_cents,
                }
            )
        if refund_sum > amount_cents:
            metrics["refund_exceeds_order_amount"] += 1
            issues.append(
                {
                    "event_id": event_id,
                    "issue": "refund_exceeds_order_amount",
                    "refund_detail_sum_cents": refund_sum,
                    "order_amount_cents": amount_cents,
                }
            )
    return {
        "phone": p or None,
        "checked_rows": len(rows),
        "issues_count": len(issues),
        "metrics": metrics,
        "issues": issues[:500],
    }


def ensure_saved_voices_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_saved_voices (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  voices JSONB NOT NULL DEFAULT '[]'::jsonb,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()


def _normalize_saved_voice_rows(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voiceId") or "").strip()
        if not voice_id or voice_id in seen:
            continue
        seen.add(voice_id)
        out.append(
            {
                "voiceId": voice_id,
                "displayName": str(item.get("displayName") or voice_id).strip() or voice_id,
                "createdAt": item.get("createdAt"),
                "lastUsedAt": item.get("lastUsedAt"),
            }
        )
    return out[:200]


def list_saved_voices_for_user(user_ref: str) -> list[dict[str, Any]]:
    """已登录用户：从 DB 读取收藏音色。"""
    p = (user_ref or "").strip()
    if not p:
        return []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            uid = _resolve_user_uuid_from_ref(cur, p)
            if not uid:
                return []
            cur.execute("SELECT voices FROM user_saved_voices WHERE user_id = %s", (uid,))
            row = cur.fetchone()
            if not row or row.get("voices") is None:
                return []
            return _normalize_saved_voice_rows(row["voices"])


def replace_saved_voices_for_user(user_ref: str, voices: list[dict[str, Any]]) -> tuple[bool, str, int]:
    """覆盖写入当前用户收藏音色（最多 200 条）。返回保存后的条数。"""
    p = (user_ref or "").strip()
    if not p:
        return False, "未登录", 0
    normalized = _normalize_saved_voice_rows(voices)
    with get_conn() as conn:
        uid = _ensure_user_id_for_phone_conn(conn, p)
        if not uid:
            return False, "未找到用户", 0
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO user_saved_voices (user_id, voices, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (user_id) DO UPDATE SET voices = EXCLUDED.voices, updated_at = NOW()
                """,
                (uid, json.dumps(normalized)),
            )
        conn.commit()
    return True, "", len(normalized)


def append_cloned_voice_for_user_uuid(user_uuid: str | None, voice_id: str, display_name: str | None = None) -> None:
    """
    音色克隆成功后写入「我的音色」列表（与 jobs.created_by 同一 users.id）。
    幂等：相同 voiceId 时更新 displayName，保留原 createdAt。
    """
    raw_uid = (user_uuid or "").strip()
    vid = (voice_id or "").strip()
    if not raw_uid or not vid:
        return
    try:
        uid = str(uuid.UUID(raw_uid))
    except (ValueError, TypeError, AttributeError):
        return
    dn = (display_name or "").strip() or vid
    ensure_saved_voices_schema()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute("SELECT 1 FROM users WHERE id = %s::uuid LIMIT 1", (uid,))
                if not cur.fetchone():
                    return
                cur.execute(
                    "SELECT voices FROM user_saved_voices WHERE user_id = %s::uuid LIMIT 1",
                    (uid,),
                )
                row = cur.fetchone()
                raw_list: Any = row.get("voices") if row else None
                existing = _normalize_saved_voice_rows(raw_list)
                old = next((x for x in existing if str(x.get("voiceId") or "").strip() == vid), None)
                kept = [x for x in existing if str(x.get("voiceId") or "").strip() != vid]
                new_row: dict[str, Any] = {
                    "voiceId": vid,
                    "displayName": dn,
                    "createdAt": old.get("createdAt") if isinstance(old, dict) else now_iso,
                    "lastUsedAt": old.get("lastUsedAt") if isinstance(old, dict) else None,
                }
                merged = _normalize_saved_voice_rows([new_row, *kept])
                cur.execute(
                    """
                    INSERT INTO user_saved_voices (user_id, voices, updated_at)
                    VALUES (%s::uuid, %s::jsonb, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET voices = EXCLUDED.voices, updated_at = NOW()
                    """,
                    (uid, json.dumps(merged)),
                )
            conn.commit()
    except Exception:
        return


# --- 用户浏览器偏好多端同步（与 apps/web/lib/cloudPreferences.ts 白名单一致） ---
ALLOWED_USER_PREF_KEYS: frozenset[str] = frozenset(
    {
        "fym_user_templates_v1",
        "fym_native_works_folders_v1",
        "fym_native_works_assign_v1",
        "fym_podcast_works_hidden_v1",
        "fym_podcast_works_display_titles_v1",
        "fym_tts_works_hidden_v1",
        "fym_tts_works_display_titles_v1",
        "fym_notes_works_hidden_v1",
        "fym_notes_works_display_titles_v1",
        "fym_notes_studio_works_hidden_v1",
        "fym_notes_studio_works_display_titles_v1",
        "minimax_aipodcast_enabled_preset_voices",
        "minimax_aipodcast_speaker_default_voice_keys",
        "minimax_aipodcast_speaker_cloned_voice_ids",
        "fym_favorite_voice_ids_v1",
        # 订阅页「选用套餐」意向（付费档不落库生效，仅支付回调改档）
        "subscription_checkout_intent_v1",
    }
)
MAX_USER_PREFERENCES_JSON_BYTES = 480_000


def ensure_user_preferences_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_preferences (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  data JSONB NOT NULL DEFAULT '{}'::jsonb,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()


def sync_user_display_name_to_pg(phone: str, display_name: str) -> None:
    """将展示名写入 PostgreSQL users（便于统计与多端一致）；失败静默。"""
    p = (phone or "").strip()
    if not p:
        return
    dn = (display_name or "").strip() or p
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    INSERT INTO users (phone, display_name, role, updated_at)
                    VALUES (%s, %s, 'user', NOW())
                    ON CONFLICT (phone) DO UPDATE SET
                      display_name = EXCLUDED.display_name,
                      updated_at = NOW()
                    """,
                    (p, dn),
                )
            conn.commit()
    except Exception:
        return


def _ensure_user_id_for_phone_conn(conn, phone: str) -> str | None:
    """解析 users.id：支持 UUID、手机号；必要时为合法手机号插入占位行。"""
    p = (phone or "").strip()
    if not p:
        return None
    with get_cursor(conn) as cur:
        try:
            u = uuid.UUID(p)
            cur.execute("SELECT id FROM users WHERE id = %s::uuid LIMIT 1", (str(u),))
            row0 = cur.fetchone()
            if row0 and row0.get("id") is not None:
                return str(row0["id"])
        except Exception:
            pass
        p_norm = _normalize_phone_digits(p)
        cur.execute(
            "SELECT id FROM users WHERE phone = %s OR (phone_normalized IS NOT NULL AND phone_normalized = %s) LIMIT 1",
            (p, p_norm),
        )
        row = cur.fetchone()
        if row and row.get("id") is not None:
            return str(row["id"])
        if not p_norm or len(p_norm) < 11:
            return None
        try:
            cur.execute(
                """
                INSERT INTO users (phone, phone_normalized, display_name, role, updated_at)
                VALUES (%s, %s, %s, 'user', NOW())
                RETURNING id
                """,
                (p, p_norm, p),
            )
            ins = cur.fetchone()
            if ins and ins.get("id") is not None:
                return str(ins["id"])
        except IntegrityError:
            pass
        cur.execute(
            "SELECT id FROM users WHERE phone = %s OR (phone_normalized IS NOT NULL AND phone_normalized = %s) LIMIT 1",
            (p, p_norm),
        )
        row2 = cur.fetchone()
        return str(row2["id"]) if row2 and row2.get("id") is not None else None


def get_user_preferences_for_phone(phone: str) -> dict[str, Any]:
    p = (phone or "").strip()
    if not p:
        return {}
    try:
        with get_conn() as conn:
            uid = _ensure_user_id_for_phone_conn(conn, p)
            if not uid:
                return {}
            with get_cursor(conn) as cur:
                cur.execute(
                    "SELECT data, updated_at FROM user_preferences WHERE user_id = %s LIMIT 1",
                    (uid,),
                )
                row = cur.fetchone()
                if not row or row.get("data") is None:
                    return {}
                raw = row["data"]
                return dict(raw) if isinstance(raw, dict) else {}
    except Exception:
        return {}


def get_subscription_checkout_intent_for_api(phone: str) -> dict[str, Any] | None:
    """订阅页「选用付费档」意向；未设置或非有效档位返回 None。"""
    prefs = get_user_preferences_for_phone(phone)
    raw = prefs.get("subscription_checkout_intent_v1")
    if not isinstance(raw, dict):
        return None
    tid = str(raw.get("tier") or "").strip().lower()
    if tid not in ("basic", "pro", "max"):
        return None
    bc_raw = raw.get("billing_cycle")
    bc = str(bc_raw).strip().lower() if bc_raw else None
    if bc != "monthly":
        return None
    return {"tier": tid, "billing_cycle": bc}


def merge_user_preferences_for_phone(phone: str, patch: dict[str, Any]) -> tuple[bool, str]:
    p = (phone or "").strip()
    if not p:
        return False, "未登录"
    if not isinstance(patch, dict):
        return False, "无效数据"
    filtered: dict[str, Any] = {}
    for k, v in patch.items():
        ks = str(k)
        if ks not in ALLOWED_USER_PREF_KEYS:
            continue
        filtered[ks] = v
    if not filtered:
        return False, "无有效字段"
    try:
        with get_conn() as conn:
            uid = _ensure_user_id_for_phone_conn(conn, p)
            if not uid:
                return False, "未找到用户"
            with get_cursor(conn) as cur:
                cur.execute(
                    "SELECT data FROM user_preferences WHERE user_id = %s LIMIT 1",
                    (uid,),
                )
                row = cur.fetchone()
                base: dict[str, Any] = {}
                if row and row.get("data") is not None and isinstance(row["data"], dict):
                    base = dict(row["data"])
                merged = {**base, **filtered}
                blob = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
                if len(blob.encode("utf-8")) > MAX_USER_PREFERENCES_JSON_BYTES:
                    return False, "偏好数据过大"
                cur.execute(
                    """
                    INSERT INTO user_preferences (user_id, data, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET
                      data = EXCLUDED.data,
                      updated_at = NOW()
                    """,
                    (uid, json.dumps(merged, ensure_ascii=False)),
                )
            conn.commit()
    except Exception:
        return False, "保存失败"
    return True, ""


def ensure_users_profile_columns() -> None:
    """为 users 表补充档位与按手机号解析用户所需列（兼容旧库、未跑 011 迁移的实例）。"""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT")
            cur.execute(
                """
                UPDATE users
                SET phone_normalized = regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
                WHERE (phone_normalized IS NULL OR phone_normalized = '')
                  AND phone IS NOT NULL AND btrim(phone) <> ''
                """
            )
            conn.commit()


def sync_user_profile_to_pg(
    phone: str = "",
    *,
    user_id: str | None = None,
    display_name: str | None = None,
    role: str | None = None,
    plan: str | None = None,
    billing_cycle: str | None = None,
) -> None:
    """将用户核心档案同步到 PG users（仅覆盖传入字段）；优先按 user_id 更新。"""
    uid = (user_id or "").strip()
    p = (phone or "").strip()
    p_norm = _normalize_phone_digits(p)
    if not uid and not p:
        return
    dn = (display_name or "").strip()
    rl = (role or "").strip().lower()
    pl = (plan or "").strip().lower()
    bc = (billing_cycle or "").strip().lower() if billing_cycle is not None else None
    if rl and rl not in ("user", "admin"):
        rl = "user"
    if pl and pl not in USER_SUBSCRIPTION_TIERS:
        pl = "free"
    if uid:
        try:
            uuid.UUID(uid)
        except Exception:
            uid = ""
    try:
        ensure_users_profile_columns()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                if uid:
                    cur.execute(
                        """
                        UPDATE users SET
                          display_name = COALESCE(NULLIF(%s, ''), display_name),
                          role = COALESCE(NULLIF(%s, ''), role),
                          plan = COALESCE(NULLIF(%s, ''), plan),
                          billing_cycle = CASE WHEN %s IS NULL THEN billing_cycle ELSE %s END,
                          updated_at = NOW()
                        WHERE id = %s::uuid
                        """,
                        (dn, rl or None, pl or None, bc, bc, uid),
                    )
                    if cur.rowcount and cur.rowcount > 0:
                        conn.commit()
                        return
                if not p:
                    conn.commit()
                    return
                cur.execute(
                    """
                    UPDATE users SET
                      phone_normalized = COALESCE(NULLIF(%s, ''), phone_normalized),
                      display_name = COALESCE(NULLIF(%s, ''), display_name),
                      role = COALESCE(NULLIF(%s, ''), role),
                      plan = COALESCE(NULLIF(%s, ''), plan),
                      billing_cycle = CASE WHEN %s IS NULL THEN billing_cycle ELSE %s END,
                      updated_at = NOW()
                    WHERE phone = %s OR (phone_normalized IS NOT NULL AND phone_normalized = %s)
                    """,
                    (p_norm, dn, rl or None, pl or None, bc, bc, p, p_norm),
                )
            conn.commit()
    except Exception:
        return


def get_user_profile_from_pg(phone: str) -> dict[str, Any] | None:
    p = (phone or "").strip()
    p_norm = _normalize_phone_digits(p)
    if not p:
        return None
    try:
        ensure_users_profile_columns()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    SELECT phone, display_name, role, plan, billing_cycle
                    FROM users
                    WHERE phone = %s OR (phone_normalized IS NOT NULL AND phone_normalized = %s)
                    LIMIT 1
                    """,
                    (p, p_norm),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "phone": str(row.get("phone") or p),
                    "display_name": str(row.get("display_name") or p),
                    "role": str(row.get("role") or "user"),
                    "plan": str(row.get("plan") or "free"),
                    "billing_cycle": row.get("billing_cycle"),
                }
    except Exception:
        return None


def ensure_subscription_events_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_events (
                  id BIGSERIAL PRIMARY KEY,
                  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL,
                  event_type TEXT NOT NULL DEFAULT 'unknown',
                  billing_cycle TEXT,
                  effective_at TIMESTAMPTZ,
                  expires_at TIMESTAMPTZ,
                  order_event_id TEXT,
                  source TEXT NOT NULL DEFAULT 'unknown',
                  actor_phone TEXT,
                  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'unknown'")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS order_event_id TEXT")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_events_phone_created_at ON subscription_events(phone, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_events_user_created_at ON subscription_events(user_id, created_at DESC)"
            )
            conn.commit()


_SUBSCRIPTION_EVENT_TYPES = frozenset(
    {
        "unknown",
        "subscription_set",
        "manual_set",
        "upgrade",
        "downgrade",
        "renew",
        "cancel",
        "refund",
        "expire",
        "payment_paid",
        "payment_failed",
        "payment_refunded",
        "payment_partially_refunded",
        "payment_authorized",
        "payment_pending_payment",
        "payment_chargeback",
        "payment_disputed",
    }
)


def _normalize_subscription_event_type(event_type: str | None) -> str:
    et = (event_type or "unknown").strip().lower() or "unknown"
    return et if et in _SUBSCRIPTION_EVENT_TYPES else "unknown"


def _state_status_from_event_type(event_type: str, tier: str) -> str:
    if event_type in ("payment_failed", "payment_chargeback", "payment_disputed"):
        return "payment_failed"
    if event_type in ("cancel", "refund", "payment_refunded", "payment_partially_refunded"):
        return "inactive"
    if event_type in ("expire",):
        return "expired"
    if tier == "free":
        return "inactive"
    return "active"


def _normalize_payment_order_status(status: str | None) -> str:
    raw = (status or "").strip().lower()
    mapping = {
        "success": "paid",
        "succeeded": "paid",
        "paid": "paid",
        "captured": "paid",
        "ok": "paid",
        "fail": "failed",
        "failed": "failed",
        "error": "failed",
        "refund": "refunded",
        "refunded": "refunded",
        "partial_refund": "partially_refunded",
        "partially_refunded": "partially_refunded",
        "pending_payment": "pending_payment",
        "pending": "pending_payment",
        "authorized": "authorized",
        "auth": "authorized",
        "chargeback": "chargeback",
        "disputed": "disputed",
        "expired": "expired",
        "closed": "closed",
        "cancel": "cancelled",
        "cancelled": "cancelled",
        "created": "created",
    }
    return mapping.get(raw, "unknown")


def _normalize_currency_code(currency: str | None) -> str:
    code = (currency or "CNY").strip().upper()
    allowed = {"CNY", "USD", "EUR", "JPY", "HKD", "SGD"}
    return code if code in allowed else "CNY"


def _normalize_channel(channel: str | None) -> str:
    raw = (channel or "unknown").strip().lower()
    allowed = {"alipay", "stripe", "apple", "google", "unknown"}
    return raw if raw in allowed else "unknown"


def _payment_status_rank(status: str) -> int:
    order = {
        "unknown": 0,
        "created": 1,
        "pending_payment": 2,
        "authorized": 3,
        "paid": 4,
        "partially_refunded": 5,
        "refunded": 6,
        "failed": 6,
        "cancelled": 6,
        "expired": 6,
        "closed": 6,
        "chargeback": 7,
        "disputed": 7,
    }
    return order.get((status or "").strip().lower(), 0)


def _is_payment_status_transition_allowed(old_status: str, new_status: str) -> bool:
    o = (old_status or "unknown").strip().lower()
    n = (new_status or "unknown").strip().lower()
    if o == n:
        return True
    # 终态后不允许回退或反向跳转
    if o in {"refunded", "chargeback"} and n != o:
        return False
    if o in {"failed", "cancelled", "expired", "closed"} and n in {
        "created",
        "unknown",
        "pending_payment",
        "authorized",
        "paid",
    }:
        return False
    if o == "paid" and n in {"created", "unknown", "pending_payment", "authorized", "failed", "cancelled"}:
        return False
    if o == "partially_refunded" and n in {"created", "unknown", "pending_payment", "authorized", "paid"}:
        return False
    return _payment_status_rank(n) >= _payment_status_rank(o)


def _normalize_decimal_to_str(value: Any, *, scale: int = 8) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return format(Decimal(raw).quantize(Decimal(10) ** -scale), f".{scale}f")
    except (InvalidOperation, ValueError):
        return None


def record_subscription_event(
    phone: str,
    tier: str,
    billing_cycle: str | None,
    *,
    event_type: str = "unknown",
    effective_at: datetime | None = None,
    expires_at: datetime | None = None,
    order_event_id: str | None = None,
    trace_id: str | None = None,
    request_id: str | None = None,
    source: str,
    actor_phone: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    p = (phone or "").strip()
    if not p:
        return
    t = (tier or "free").strip().lower()
    if t not in USER_SUBSCRIPTION_TIERS:
        t = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    et = _normalize_subscription_event_type(event_type)
    order_eid = (order_event_id or "").strip() or None
    tid = (trace_id or "").strip() or None
    rid = (request_id or "").strip() or None
    src = (source or "unknown").strip()[:64] or "unknown"
    ap = (actor_phone or "").strip() or None
    payload = meta if isinstance(meta, dict) else {}
    try:
        ensure_subscription_events_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                # 支付回调事件幂等：同 order_event_id + event_type + source 仅保留一条
                if src == "payment_webhook" and order_eid and et.startswith("payment_"):
                    cur.execute(
                        """
                        SELECT id
                        FROM subscription_events
                        WHERE source = %s AND order_event_id = %s AND event_type = %s
                        LIMIT 1
                        """,
                        (src, order_eid, et),
                    )
                    existed = cur.fetchone()
                    if existed:
                        conn.commit()
                        return
                cur.execute(
                    """
                    INSERT INTO subscription_events
                      (user_id, phone, tier, event_type, billing_cycle, effective_at, expires_at, order_event_id, trace_id, request_id, source, actor_phone, meta, created_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                    """,
                    (uid, p, t, et, bc, effective_at, expires_at, order_eid, tid, rid, src, ap, json.dumps(payload, ensure_ascii=False)),
                )
            conn.commit()
        upsert_subscription_current_state(
            phone=p,
            tier=t,
            billing_cycle=bc,
            status=_state_status_from_event_type(et, t),
            effective_at=effective_at,
            expires_at=expires_at,
            source=src,
            order_event_id=order_eid,
        )
    except Exception:
        return


def ensure_payment_orders_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_orders (
                  id BIGSERIAL PRIMARY KEY,
                  event_id TEXT UNIQUE NOT NULL,
                  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL DEFAULT 'free',
                  billing_cycle TEXT,
                  status TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL DEFAULT 0,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  created_at_unix BIGINT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'unknown'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS raw_schema_version TEXT NOT NULL DEFAULT 'v1'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS settlement_currency TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS fx_rate_snapshot NUMERIC(18,8)")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS refunded_amount_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS client_request_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS amount_subtotal_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS tax_cents BIGINT NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payable_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paid_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS source_ip TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS user_agent TEXT")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_orders_phone_created_at ON payment_orders(phone, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created_at ON payment_orders(user_id, created_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_provider_order ON payment_orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL AND btrim(provider_order_id) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_idempotency_key ON payment_orders(provider, idempotency_key) WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_client_request_id ON payment_orders(provider, client_request_id) WHERE client_request_id IS NOT NULL AND btrim(client_request_id) <> ''"
            )
            conn.commit()


def ensure_payment_webhook_deliveries_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_webhook_deliveries (
                  id BIGSERIAL PRIMARY KEY,
                  event_id TEXT NOT NULL,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  signature_ok BOOLEAN NOT NULL DEFAULT FALSE,
                  payload_hash TEXT NOT NULL,
                  process_result TEXT NOT NULL DEFAULT 'received',
                  error TEXT,
                  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS delivery_count BIGINT NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_webhook_deliveries_event_received ON payment_webhook_deliveries(event_id, received_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_webhook_deliveries_provider_event_payload ON payment_webhook_deliveries(provider, event_id, payload_hash)"
            )
            conn.commit()


def record_payment_webhook_delivery(
    *,
    event_id: str,
    provider: str,
    signature_ok: bool,
    payload_hash: str,
    process_result: str,
    payload: dict[str, Any] | None = None,
    payload_redacted: dict[str, Any] | None = None,
    error: str | None = None,
    trace_id: str | None = None,
    request_id: str | None = None,
) -> None:
    eid = (event_id or "").strip() or "unknown"
    pv = (provider or "unknown").strip()[:64] or "unknown"
    ph = (payload_hash or "").strip()[:128] or "none"
    pr = (process_result or "received").strip()[:64] or "received"
    er = (error or "").strip()[:500] or None
    tid = (trace_id or "").strip() or None
    rid = (request_id or "").strip() or None
    raw = payload if isinstance(payload, dict) else {}
    redacted = payload_redacted if isinstance(payload_redacted, dict) else {}
    try:
        ensure_payment_webhook_deliveries_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    INSERT INTO payment_webhook_deliveries
                      (event_id, provider, signature_ok, payload_hash, process_result, error, payload, payload_redacted, first_received_at, last_received_at, delivery_count, trace_id, request_id, received_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, NOW(), NOW(), 1, %s, %s, NOW())
                    ON CONFLICT (provider, event_id, payload_hash) DO UPDATE SET
                      signature_ok = EXCLUDED.signature_ok,
                      process_result = EXCLUDED.process_result,
                      error = EXCLUDED.error,
                      payload = EXCLUDED.payload,
                      payload_redacted = EXCLUDED.payload_redacted,
                      delivery_count = payment_webhook_deliveries.delivery_count + 1,
                      last_received_at = NOW(),
                      trace_id = COALESCE(EXCLUDED.trace_id, payment_webhook_deliveries.trace_id),
                      request_id = COALESCE(EXCLUDED.request_id, payment_webhook_deliveries.request_id),
                      received_at = NOW()
                    """,
                    (
                        eid,
                        pv,
                        bool(signature_ok),
                        ph,
                        pr,
                        er,
                        json.dumps(raw, ensure_ascii=False),
                        json.dumps(redacted, ensure_ascii=False),
                        tid,
                        rid,
                    ),
                )
            conn.commit()
    except Exception:
        return


def ensure_payment_refunds_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_refunds (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  refund_id TEXT NOT NULL,
                  refund_status TEXT NOT NULL DEFAULT 'processed',
                  refunded_amount_cents BIGINT NOT NULL DEFAULT 0,
                  currency TEXT NOT NULL DEFAULT 'CNY',
                  refunded_at TIMESTAMPTZ,
                  reason TEXT,
                  trace_id TEXT,
                  request_id TEXT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_provider_refund_id ON payment_refunds(provider, refund_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_refunds_order_created ON payment_refunds(order_event_id, created_at DESC)"
            )
            conn.commit()


def ensure_payment_transactions_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_transactions (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  transaction_type TEXT NOT NULL DEFAULT 'payment',
                  transaction_status TEXT NOT NULL DEFAULT 'unknown',
                  amount_cents BIGINT NOT NULL DEFAULT 0,
                  currency TEXT NOT NULL DEFAULT 'CNY',
                  provider_transaction_id TEXT,
                  idempotency_key TEXT,
                  client_request_id TEXT,
                  occurred_at TIMESTAMPTZ,
                  trace_id TEXT,
                  request_id TEXT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_created ON payment_transactions(order_event_id, created_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_provider_trade_no ON payment_transactions(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL AND btrim(provider_transaction_id) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_idempotency_key ON payment_transactions(provider, idempotency_key) WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''"
            )
            conn.commit()


def ensure_payment_order_items_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_order_items (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  line_no INTEGER NOT NULL DEFAULT 1,
                  product_id TEXT,
                  sku TEXT,
                  name TEXT,
                  unit_price_cents BIGINT NOT NULL DEFAULT 0,
                  quantity INTEGER NOT NULL DEFAULT 1,
                  line_subtotal_cents BIGINT NOT NULL DEFAULT 0,
                  discount_cents BIGINT NOT NULL DEFAULT 0,
                  tax_cents BIGINT NOT NULL DEFAULT 0,
                  payable_cents BIGINT NOT NULL DEFAULT 0,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_order_items_line ON payment_order_items(order_event_id, line_no)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_order_items_order ON payment_order_items(order_event_id)"
            )
            conn.commit()


def ensure_subscription_current_state_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_current_state (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL,
                  billing_cycle TEXT,
                  status TEXT NOT NULL DEFAULT 'active',
                  effective_at TIMESTAMPTZ,
                  expires_at TIMESTAMPTZ,
                  source TEXT NOT NULL DEFAULT 'unknown',
                  order_event_id TEXT,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_current_state_phone ON subscription_current_state(phone)"
            )
            conn.commit()


def ensure_user_payg_minute_grants_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_payg_minute_grants (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  minutes NUMERIC(12, 2) NOT NULL CHECK (minutes > 0),
                  expires_at TIMESTAMPTZ NOT NULL,
                  payment_event_id TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  CONSTRAINT user_payg_minute_grants_payment_event_id_key UNIQUE (payment_event_id)
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_payg_grants_user_expires ON user_payg_minute_grants (user_id, expires_at DESC)"
            )
            cur.execute(
                "ALTER TABLE user_payg_minute_grants ADD COLUMN IF NOT EXISTS minutes_remaining NUMERIC(12, 2)"
            )
            cur.execute(
                """
                UPDATE user_payg_minute_grants
                SET minutes_remaining = minutes
                WHERE minutes_remaining IS NULL
                """
            )
            conn.commit()


def payg_minutes_remaining_for_phone(phone: str) -> float:
    """未过期按次分钟包剩余分钟合计（`minutes_remaining`，旧行回退为 `minutes`）。"""
    p = (phone or "").strip()
    if not p:
        return 0.0
    try:
        ensure_user_payg_minute_grants_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return 0.0
                cur.execute(
                    """
                    SELECT COALESCE(SUM(COALESCE(minutes_remaining, minutes)), 0) AS s
                    FROM user_payg_minute_grants
                    WHERE user_id = %s
                      AND expires_at > NOW()
                      AND COALESCE(minutes_remaining, minutes) > 0
                    """,
                    (uid,),
                )
                row = cur.fetchone() or {}
                raw = row.get("s")
                if raw is None:
                    return 0.0
                return float(Decimal(str(raw)))
    except Exception:
        return 0.0


def _subscription_audio_minutes_used_for_uid_cur(cur: Any, uid: str, days: int = 30) -> float:
    """与 subscription_media_usage_for_phone 音频口径一致，供扣费事务内读取（避免读到未提交数据外的不一致）。"""
    d = max(1, min(366, int(days)))
    cur.execute(
        """
        SELECT COALESCE(
                 SUM(
                   CASE
                     WHEN j.result::jsonb ? 'audio_duration_sec'
                          AND NULLIF(btrim(j.result::jsonb->>'audio_duration_sec'), '') IS NOT NULL
                       THEN (j.result::jsonb->>'audio_duration_sec')::double precision
                     ELSE 0::double precision
                   END
                 ),
                 0::double precision
               )
               / 60.0 AS audio_minutes
        FROM jobs j
        LEFT JOIN projects p ON p.id = j.project_id
        WHERE j.deleted_at IS NULL
          AND j.status = 'succeeded'
          AND j.job_type = ANY(%s::text[])
          AND j.completed_at >= NOW() - (%s * INTERVAL '1 day')
          AND COALESCE(j.created_by, p.user_id) = %s::uuid
        """,
        (["text_to_speech", "tts", "podcast_generate", "podcast"], d, uid),
    )
    row = cur.fetchone()
    return float(row["audio_minutes"] or 0) if row else 0.0


def _payg_try_consume_minutes_cur(cur: Any, user_id: str, need: float) -> tuple[float, list[tuple[str, Decimal]]]:
    """按过期时间 FIFO 扣减按次分钟包；返回 (实际扣减分钟, 回滚日志)。"""
    if need <= 1e-12:
        return 0.0, []
    need_dec = Decimal(str(need))
    total = Decimal("0")
    log: list[tuple[str, Decimal]] = []
    while need_dec > Decimal("0.0001"):
        cur.execute(
            """
            SELECT id, COALESCE(minutes_remaining, minutes) AS rem
            FROM user_payg_minute_grants
            WHERE user_id = %s::uuid
              AND expires_at > NOW()
              AND COALESCE(minutes_remaining, minutes) > 0.0001
            ORDER BY expires_at ASC
            FOR UPDATE
            LIMIT 1
            """,
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            break
        gid = str(row["id"])
        rem = Decimal(str(row["rem"] or 0))
        if rem <= 0:
            break
        take = min(rem, need_dec)
        new_rem = rem - take
        cur.execute(
            """
            UPDATE user_payg_minute_grants
            SET minutes_remaining = %s
            WHERE id = %s::uuid
            """,
            (new_rem, gid),
        )
        need_dec -= take
        total += take
        log.append((gid, take))
    return float(total), log


def payg_restore_minutes_from_log(phone: str, restores: list[tuple[str, float]]) -> None:
    """任务失败后将已扣的按次分钟包加回（与钱包退款配合使用）。"""
    p = (phone or "").strip()
    if not p or not restores:
        return
    try:
        ensure_user_payg_minute_grants_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return
                for gid, amt in restores:
                    if amt <= 1e-12:
                        continue
                    cur.execute(
                        """
                        UPDATE user_payg_minute_grants
                        SET minutes_remaining = COALESCE(minutes_remaining, minutes) + %s
                        WHERE id = %s::uuid AND user_id = %s::uuid
                        """,
                        (Decimal(str(amt)), gid, uid),
                    )
            conn.commit()
    except Exception:
        logger.exception("payg_restore_minutes_from_log failed phone=%s", p[:4] if p else "")


def media_billing_try_debit_estimated_minutes(
    phone: str,
    tier: str | None,
    est_minutes: float,
    *,
    period_days: int = 30,
) -> tuple[bool, int, dict[str, Any]]:
    """
    事务内：按预估分钟先扣按次包再扣钱包（与会员页「近 N 天音频用量」同一周期）。
    返回 (是否成功, 实际从钱包扣的分, meta)。
    meta: payg_restores, wallet_cents, from_payg_minutes, message(失败时)
    """
    from . import media_wallet as _mw

    base_meta: dict[str, Any] = {
        "payg_restores": [],
        "wallet_cents": 0,
        "from_payg_minutes": 0.0,
    }
    if not _mw.media_wallet_billing_enabled():
        return True, 0, dict(base_meta)
    p = (phone or "").strip()
    if not p or float(est_minutes) <= 1e-9:
        return True, 0, dict(base_meta)
    ensure_user_payg_minute_grants_schema()
    ensure_user_wallet_schema()
    tnorm = (tier or "free").strip().lower()
    cap = int(MONTHLY_MINUTES_PRODUCT_BY_TIER.get(tnorm, MONTHLY_MINUTES_PRODUCT_BY_TIER["free"]))
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return False, 0, {
                        **base_meta,
                        "reason": "no_user",
                        "message": "未找到账户，无法结算语音用量",
                    }
                used = _subscription_audio_minutes_used_for_uid_cur(cur, uid, period_days)
                sub_room = max(0.0, float(cap) - float(used))
                from_sub = min(float(est_minutes), sub_room)
                rem = float(est_minutes) - from_sub
                payg_log: list[tuple[str, Decimal]] = []
                consumed_payg = 0.0
                if rem > 1e-9:
                    consumed_payg, payg_log = _payg_try_consume_minutes_cur(cur, uid, rem)
                wallet_min = max(0.0, rem - consumed_payg)
                cents = int(_mw.wallet_cents_for_overage_minutes(wallet_min))
                meta = {
                    **base_meta,
                    "from_payg_minutes": float(consumed_payg),
                    "payg_restores": [(str(gid), float(amt)) for gid, amt in payg_log],
                    "wallet_cents": cents,
                }
                if cents > 0:
                    cur.execute(
                        """
                        UPDATE user_wallet_balance
                        SET balance_cents = balance_cents - %s,
                            phone = %s,
                            updated_at = NOW()
                        WHERE user_id = %s::uuid AND balance_cents >= %s
                        RETURNING balance_cents
                        """,
                        (cents, p, uid, cents),
                    )
                    row_w = cur.fetchone()
                    if not row_w:
                        conn.rollback()
                        return False, 0, {
                            **base_meta,
                            "reason": "insufficient_wallet",
                            "message": (
                                f"钱包余额不足：此次预估超出套餐/分钟包约 {wallet_min:.2f} 分钟，"
                                f"需约 ¥{cents / 100:.2f}，请充值后再试。"
                            ),
                        }
                    meta["balance_cents_after"] = int(row_w.get("balance_cents") or 0)
                conn.commit()
                return True, cents, meta
    except Exception as exc:
        logger.exception("media_billing_try_debit_estimated_minutes failed")
        return False, 0, {**base_meta, "reason": "error", "message": str(exc)[:300]}


def ensure_user_wallet_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_wallet_balance (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_wallet_topups (
                  payment_event_id TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_checkout_sessions (
                  checkout_id TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_wallet_checkout_user_created ON wallet_checkout_sessions (user_id, created_at DESC)"
            )
            conn.commit()


def wallet_balance_cents_for_phone(phone: str) -> int:
    p = (phone or "").strip()
    if not p:
        return 0
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return 0
                cur.execute(
                    "SELECT balance_cents FROM user_wallet_balance WHERE user_id = %s LIMIT 1",
                    (uid,),
                )
                row = cur.fetchone() or {}
                return int(row.get("balance_cents") or 0)
    except Exception:
        return 0


def wallet_try_debit_cents(phone: str, cents: int) -> tuple[bool, int]:
    """
    从钱包扣减指定分；余额不足则不扣。
    返回 (是否成功, 扣后余额；-1 表示未扣款且无法读取余额)。
    """
    p = (phone or "").strip()
    try:
        debit = int(cents)
    except (TypeError, ValueError):
        return False, -1
    if not p or debit <= 0:
        return False, -1
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return False, -1
                cur.execute(
                    """
                    UPDATE user_wallet_balance
                    SET balance_cents = balance_cents - %s,
                        phone = %s,
                        updated_at = NOW()
                    WHERE user_id = %s AND balance_cents >= %s
                    RETURNING balance_cents
                    """,
                    (debit, p, uid, debit),
                )
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        "SELECT balance_cents FROM user_wallet_balance WHERE user_id = %s LIMIT 1",
                        (uid,),
                    )
                    bal_row = cur.fetchone() or {}
                    return False, int(bal_row.get("balance_cents") or 0)
                conn.commit()
                return True, int(row.get("balance_cents") or 0)
    except Exception:
        return False, -1


def wallet_credit_cents(phone: str, cents: int) -> bool:
    """
    增加钱包余额（用于克隆失败/取消后退回已扣的按次费）。
    """
    p = (phone or "").strip()
    try:
        credit = int(cents)
    except (TypeError, ValueError):
        return False
    if not p or credit <= 0:
        return False
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return False
                cur.execute(
                    """
                    UPDATE user_wallet_balance
                    SET balance_cents = balance_cents + %s,
                        phone = %s,
                        updated_at = NOW()
                    WHERE user_id = %s
                    RETURNING balance_cents
                    """,
                    (credit, p, uid),
                )
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        """
                        INSERT INTO user_wallet_balance (user_id, phone, balance_cents, updated_at)
                        VALUES (%s, %s, %s, NOW())
                        """,
                        (uid, p, credit),
                    )
                conn.commit()
                return True
    except Exception:
        logger.exception("wallet_credit_cents failed phone=%s", p[:4] if p else "")
        return False


def wallet_create_checkout_session(phone: str, checkout_id: str, amount_cents: int) -> bool:
    """写入模拟收银会话（金额与 checkout 绑定）。"""
    p = (phone or "").strip()
    cid = (checkout_id or "").strip()
    try:
        amt = int(amount_cents)
    except (TypeError, ValueError):
        return False
    if not p or not cid or amt <= 0:
        return False
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return False
                cur.execute(
                    "DELETE FROM wallet_checkout_sessions WHERE user_id = %s AND created_at < NOW() - INTERVAL '48 hours'",
                    (uid,),
                )
                cur.execute("DELETE FROM wallet_checkout_sessions WHERE checkout_id = %s", (cid,))
                cur.execute(
                    """
                    INSERT INTO wallet_checkout_sessions (checkout_id, user_id, phone, amount_cents)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (cid, uid, p, amt),
                )
            conn.commit()
        return True
    except Exception:
        return False


def wallet_get_checkout_session_amount_cents(phone: str, checkout_id: str) -> int | None:
    """读取模拟收银会话绑定金额；不存在或用户不匹配返回 None。"""
    p = (phone or "").strip()
    cid = (checkout_id or "").strip()
    if not p or not cid:
        return None
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return None
                cur.execute(
                    """
                    SELECT amount_cents FROM wallet_checkout_sessions
                    WHERE checkout_id = %s AND user_id = %s
                    LIMIT 1
                    """,
                    (cid, uid),
                )
                row = cur.fetchone()
        if not row:
            return None
        return int(row.get("amount_cents") or 0)
    except Exception:
        return None


def wallet_delete_checkout_session(phone: str, checkout_id: str) -> None:
    """支付成功后删除会话，避免重复使用同一 checkout_id。"""
    p = (phone or "").strip()
    cid = (checkout_id or "").strip()
    if not p or not cid:
        return
    try:
        ensure_user_wallet_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return
                cur.execute(
                    "DELETE FROM wallet_checkout_sessions WHERE checkout_id = %s AND user_id = %s",
                    (cid, uid),
                )
            conn.commit()
    except Exception:
        return


def ensure_alipay_page_checkout_schema() -> None:
    """支付宝电脑网站支付待支付会话（与 out_trade_no 对齐，供异步通知验额与履约）。"""
    ensure_user_wallet_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS alipay_page_checkout_sessions (
                  out_trade_no TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'wallet')),
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  tier TEXT,
                  billing_cycle TEXT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_alipay_page_checkout_user_created "
                "ON alipay_page_checkout_sessions (user_id, created_at DESC)"
            )
            conn.commit()


def alipay_page_create_checkout_session(
    phone: str,
    out_trade_no: str,
    kind: str,
    amount_cents: int,
    tier: str | None,
    billing_cycle: str | None,
) -> bool:
    p = (phone or "").strip()
    oid = (out_trade_no or "").strip()
    k = (kind or "").strip().lower()
    if not p or not oid or k not in ("subscription", "wallet"):
        return False
    try:
        amt = int(amount_cents)
    except (TypeError, ValueError):
        return False
    if amt <= 0:
        return False
    try:
        ensure_alipay_page_checkout_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                if not uid:
                    return False
                cur.execute(
                    "DELETE FROM alipay_page_checkout_sessions WHERE user_id = %s AND created_at < NOW() - INTERVAL '48 hours'",
                    (uid,),
                )
                cur.execute(
                    "DELETE FROM alipay_page_checkout_sessions WHERE user_id = %s AND kind = %s",
                    (uid, k),
                )
                cur.execute("DELETE FROM alipay_page_checkout_sessions WHERE out_trade_no = %s", (oid,))
                cur.execute(
                    """
                    INSERT INTO alipay_page_checkout_sessions
                      (out_trade_no, user_id, phone, kind, amount_cents, tier, billing_cycle)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (oid, uid, p, k, amt, (tier or None), (billing_cycle or None)),
                )
            conn.commit()
        return True
    except Exception:
        return False


def alipay_page_get_checkout_session(out_trade_no: str) -> dict | None:
    oid = (out_trade_no or "").strip()
    if not oid:
        return None
    try:
        ensure_alipay_page_checkout_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    SELECT out_trade_no, phone, kind, amount_cents, tier, billing_cycle, user_id::text AS user_id
                    FROM alipay_page_checkout_sessions
                    WHERE out_trade_no = %s
                    LIMIT 1
                    """,
                    (oid,),
                )
                row = cur.fetchone()
        if not row:
            return None
        return dict(row)
    except Exception:
        return None


def alipay_page_delete_checkout_session(out_trade_no: str) -> None:
    oid = (out_trade_no or "").strip()
    if not oid:
        return
    try:
        ensure_alipay_page_checkout_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute("DELETE FROM alipay_page_checkout_sessions WHERE out_trade_no = %s", (oid,))
            conn.commit()
    except Exception:
        return


def upsert_subscription_current_state(
    *,
    phone: str,
    tier: str,
    billing_cycle: str | None,
    status: str = "active",
    effective_at: datetime | None = None,
    expires_at: datetime | None = None,
    source: str = "unknown",
    order_event_id: str | None = None,
) -> None:
    p = (phone or "").strip()
    if not p:
        return
    t = (tier or "free").strip().lower()
    if t not in USER_SUBSCRIPTION_TIERS:
        t = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    st = (status or "active").strip().lower() or "active"
    src = (source or "unknown").strip()[:64] or "unknown"
    oeid = (order_event_id or "").strip() or None
    try:
        ensure_subscription_current_state_schema()
        with get_conn() as conn:
            uid = _ensure_user_id_for_phone_conn(conn, p)
            if not uid:
                return
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    INSERT INTO subscription_current_state
                      (user_id, phone, tier, billing_cycle, status, effective_at, expires_at, source, order_event_id, updated_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET
                      phone = EXCLUDED.phone,
                      tier = EXCLUDED.tier,
                      billing_cycle = EXCLUDED.billing_cycle,
                      status = EXCLUDED.status,
                      effective_at = EXCLUDED.effective_at,
                      expires_at = EXCLUDED.expires_at,
                      source = EXCLUDED.source,
                      order_event_id = EXCLUDED.order_event_id,
                      updated_at = NOW()
                    """,
                    (uid, p, t, bc, st, effective_at, expires_at, src, oeid),
                )
            conn.commit()
    except Exception:
        return


def _upsert_subscription_current_state_with_conn(
    conn: Any,
    *,
    phone: str,
    tier: str,
    billing_cycle: str | None,
    status: str = "active",
    effective_at: datetime | None = None,
    expires_at: datetime | None = None,
    source: str = "unknown",
    order_event_id: str | None = None,
) -> None:
    p = (phone or "").strip()
    if not p:
        return
    t = (tier or "free").strip().lower()
    if t not in USER_SUBSCRIPTION_TIERS:
        t = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    st = (status or "active").strip().lower() or "active"
    src = (source or "unknown").strip()[:64] or "unknown"
    oeid = (order_event_id or "").strip() or None
    uid = _ensure_user_id_for_phone_conn(conn, p)
    if not uid:
        return
    with get_cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO subscription_current_state
              (user_id, phone, tier, billing_cycle, status, effective_at, expires_at, source, order_event_id, updated_at)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
              phone = EXCLUDED.phone,
              tier = EXCLUDED.tier,
              billing_cycle = EXCLUDED.billing_cycle,
              status = EXCLUDED.status,
              effective_at = EXCLUDED.effective_at,
              expires_at = EXCLUDED.expires_at,
              source = EXCLUDED.source,
              order_event_id = EXCLUDED.order_event_id,
              updated_at = NOW()
            """,
            (uid, p, t, bc, st, effective_at, expires_at, src, oeid),
        )


def upsert_payment_order(
    *,
    event_id: str,
    phone: str,
    tier: str,
    billing_cycle: str | None,
    status: str,
    amount_cents: int,
    provider: str,
    created_at_unix: int | None,
    raw: dict[str, Any] | None,
    trace_id: str | None = None,
    request_id: str | None = None,
    currency: str | None = None,
    provider_order_id: str | None = None,
    channel: str | None = None,
    paid_at: datetime | None = None,
    failed_at: datetime | None = None,
    refunded_at: datetime | None = None,
    last_status_change_at: datetime | None = None,
    raw_schema_version: str | None = None,
    settlement_amount_cents: int | None = None,
    settlement_currency: str | None = None,
    fx_rate_snapshot: float | None = None,
    refunded_amount_cents: int | None = None,
) -> None:
    eid = (event_id or "").strip()
    p = (phone or "").strip()
    if not eid or not p:
        return
    t = (tier or "free").strip().lower() or "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    st = _normalize_payment_order_status(status)
    pv = (provider or "unknown").strip()[:64] or "unknown"
    ct = int(created_at_unix or 0) or None
    tid = (trace_id or "").strip() or None
    rid = (request_id or "").strip() or None
    cur_code = _normalize_currency_code(currency)
    poid = (provider_order_id or "").strip() or None
    ch = _normalize_channel(channel)
    rsv = (raw_schema_version or "v1").strip() or "v1"
    lsc = last_status_change_at or datetime.now(timezone.utc)
    settle_amount = int(settlement_amount_cents) if settlement_amount_cents is not None else None
    settle_currency = _normalize_currency_code(settlement_currency) if settlement_currency else None
    fx_rate = float(fx_rate_snapshot) if fx_rate_snapshot is not None else None
    refunded_amount = int(refunded_amount_cents) if refunded_amount_cents is not None else None
    payload = raw if isinstance(raw, dict) else {}
    try:
        ensure_payment_orders_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                cur.execute("SELECT status FROM payment_orders WHERE event_id = %s LIMIT 1", (eid,))
                existed = cur.fetchone() or {}
                old_status = str(existed.get("status") or "").strip().lower()
                if old_status and not _is_payment_status_transition_allowed(old_status, st):
                    logger.warning(
                        "reject payment status rollback event_id=%s old=%s new=%s",
                        eid,
                        old_status,
                        st,
                    )
                    return
                cur.execute(
                    """
                    INSERT INTO payment_orders
                      (event_id, user_id, phone, tier, billing_cycle, status, amount_cents, provider, created_at_unix, raw, trace_id, request_id, currency, provider_order_id, channel, paid_at, failed_at, refunded_at, last_status_change_at, raw_schema_version, settlement_amount_cents, settlement_currency, fx_rate_snapshot, refunded_amount_cents, updated_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (event_id) DO UPDATE SET
                      user_id = COALESCE(EXCLUDED.user_id, payment_orders.user_id),
                      phone = EXCLUDED.phone,
                      tier = EXCLUDED.tier,
                      billing_cycle = EXCLUDED.billing_cycle,
                      status = EXCLUDED.status,
                      amount_cents = EXCLUDED.amount_cents,
                      provider = EXCLUDED.provider,
                      created_at_unix = EXCLUDED.created_at_unix,
                      raw = EXCLUDED.raw,
                      trace_id = COALESCE(EXCLUDED.trace_id, payment_orders.trace_id),
                      request_id = COALESCE(EXCLUDED.request_id, payment_orders.request_id),
                      currency = EXCLUDED.currency,
                      provider_order_id = COALESCE(EXCLUDED.provider_order_id, payment_orders.provider_order_id),
                      channel = EXCLUDED.channel,
                      paid_at = COALESCE(EXCLUDED.paid_at, payment_orders.paid_at),
                      failed_at = COALESCE(EXCLUDED.failed_at, payment_orders.failed_at),
                      refunded_at = COALESCE(EXCLUDED.refunded_at, payment_orders.refunded_at),
                      last_status_change_at = COALESCE(EXCLUDED.last_status_change_at, payment_orders.last_status_change_at, NOW()),
                      raw_schema_version = COALESCE(NULLIF(EXCLUDED.raw_schema_version, ''), payment_orders.raw_schema_version),
                      settlement_amount_cents = COALESCE(EXCLUDED.settlement_amount_cents, payment_orders.settlement_amount_cents),
                      settlement_currency = COALESCE(EXCLUDED.settlement_currency, payment_orders.settlement_currency),
                      fx_rate_snapshot = COALESCE(EXCLUDED.fx_rate_snapshot, payment_orders.fx_rate_snapshot),
                      refunded_amount_cents = COALESCE(EXCLUDED.refunded_amount_cents, payment_orders.refunded_amount_cents),
                      updated_at = NOW()
                    """,
                    (
                        eid,
                        uid,
                        p,
                        t,
                        bc,
                        st,
                        int(amount_cents or 0),
                        pv,
                        ct,
                        json.dumps(payload, ensure_ascii=False),
                        tid,
                        rid,
                        cur_code,
                        poid,
                        ch,
                        paid_at,
                        failed_at,
                        refunded_at,
                        lsc,
                        rsv,
                        settle_amount,
                        settle_currency,
                        fx_rate,
                        refunded_amount,
                    ),
                )
            conn.commit()
    except Exception:
        return


def process_payment_event_transaction(
    *,
    event_id: str,
    phone: str,
    tier: str,
    billing_cycle: str | None,
    status: str,
    amount_cents: int,
    provider: str,
    created_at_unix: int | None,
    raw: dict[str, Any] | None,
    trace_id: str | None = None,
    request_id: str | None = None,
    currency: str | None = None,
    provider_order_id: str | None = None,
    channel: str | None = None,
    paid_at: datetime | None = None,
    failed_at: datetime | None = None,
    refunded_at: datetime | None = None,
    settlement_amount_cents: int | None = None,
    settlement_currency: str | None = None,
    fx_rate_snapshot: float | None = None,
    refunded_amount_cents: int | None = None,
    refund_id: str | None = None,
    refund_reason: str | None = None,
    idempotency_key: str | None = None,
    client_request_id: str | None = None,
    product_snapshot: dict[str, Any] | None = None,
    order_items: list[dict[str, Any]] | None = None,
    amount_subtotal_cents: int | None = None,
    discount_cents: int | None = None,
    tax_cents: int | None = None,
    payable_cents: int | None = None,
    paid_cents: int | None = None,
    source_ip: str | None = None,
    user_agent: str | None = None,
    source: str = "payment_webhook",
    actor_phone: str | None = None,
    meta: dict[str, Any] | None = None,
) -> bool:
    eid = (event_id or "").strip()
    p = (phone or "").strip()
    if not eid or not p:
        return False
    t = (tier or "free").strip().lower() or "free"
    if t not in USER_SUBSCRIPTION_TIERS:
        t = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    st = _normalize_payment_order_status(status)
    pv = (provider or "unknown").strip()[:64] or "unknown"
    ct = int(created_at_unix or 0) or None
    tid = (trace_id or "").strip() or None
    rid = (request_id or "").strip() or None
    cur_code = _normalize_currency_code(currency)
    poid = (provider_order_id or "").strip() or None
    ch = _normalize_channel(channel)
    payload = raw if isinstance(raw, dict) else {}
    settle_amount = int(settlement_amount_cents) if settlement_amount_cents is not None else None
    settle_currency = _normalize_currency_code(settlement_currency) if settlement_currency else None
    fx_rate = _normalize_decimal_to_str(fx_rate_snapshot, scale=8)
    refunded_amount = int(refunded_amount_cents) if refunded_amount_cents is not None else None
    idk = (idempotency_key or "").strip() or None
    crid = (client_request_id or "").strip() or None
    snapshot = product_snapshot if isinstance(product_snapshot, dict) else {}
    is_payg = str(snapshot.get("kind") or "").strip().lower() == "payg_minutes"
    is_wallet = str(snapshot.get("kind") or "").strip().lower() == "wallet_topup"
    skip_subscription_side_effects = is_payg or is_wallet
    items = [x for x in (order_items or []) if isinstance(x, dict)]
    subtotal_cents = int(amount_subtotal_cents) if amount_subtotal_cents is not None else None
    discount_val = int(discount_cents) if discount_cents is not None else 0
    tax_val = int(tax_cents) if tax_cents is not None else 0
    payable_val = int(payable_cents) if payable_cents is not None else None
    paid_val = int(paid_cents) if paid_cents is not None else None
    src_ip = (source_ip or "").strip() or None
    ua = (user_agent or "").strip() or None
    src = (source or "payment_webhook").strip()[:64] or "payment_webhook"
    ap = (actor_phone or "").strip() or None
    event_meta = meta if isinstance(meta, dict) else {}
    et = _normalize_subscription_event_type(f"payment_{st}")
    effective_at = datetime.now(timezone.utc)
    try:
        ensure_payment_orders_schema()
        ensure_subscription_events_schema()
        ensure_subscription_current_state_schema()
        ensure_payment_refunds_schema()
        ensure_payment_transactions_schema()
        ensure_payment_order_items_schema()
        if is_payg:
            ensure_user_payg_minute_grants_schema()
        if is_wallet:
            ensure_user_wallet_schema()
        with get_conn() as conn:
            uid = _ensure_user_id_for_phone_conn(conn, p)
            if not uid:
                conn.rollback()
                return False
            with get_cursor(conn) as cur:
                cur.execute("SELECT status FROM payment_orders WHERE event_id = %s LIMIT 1", (eid,))
                existed = cur.fetchone() or {}
                old_status = str(existed.get("status") or "").strip().lower()
                if old_status and not _is_payment_status_transition_allowed(old_status, st):
                    conn.rollback()
                    logger.warning("reject tx payment status rollback event_id=%s old=%s new=%s", eid, old_status, st)
                    return False

                if skip_subscription_side_effects:
                    cur.execute(
                        "SELECT tier, billing_cycle FROM subscription_current_state WHERE user_id = %s LIMIT 1",
                        (uid,),
                    )
                    row = cur.fetchone()
                    if row and str(row.get("tier") or "").strip().lower() in USER_SUBSCRIPTION_TIERS:
                        t = str(row.get("tier") or "free").strip().lower()
                        bc = (str(row.get("billing_cycle") or "").strip().lower() or None)
                    else:
                        cur.execute(
                            "SELECT plan, billing_cycle FROM users WHERE id = %s LIMIT 1",
                            (uid,),
                        )
                        ur = cur.fetchone() or {}
                        tp = str(ur.get("plan") or "free").strip().lower()
                        t = tp if tp in USER_SUBSCRIPTION_TIERS else "free"
                        bc = (str(ur.get("billing_cycle") or "").strip().lower() or None)

                cur.execute(
                    """
                    INSERT INTO payment_orders
                      (event_id, user_id, phone, tier, billing_cycle, status, amount_cents, provider, created_at_unix, raw, trace_id, request_id, currency, provider_order_id, channel, paid_at, failed_at, refunded_at, last_status_change_at, raw_schema_version, settlement_amount_cents, settlement_currency, fx_rate_snapshot, refunded_amount_cents, idempotency_key, client_request_id, product_snapshot, amount_subtotal_cents, discount_cents, tax_cents, payable_cents, paid_cents, source_ip, user_agent, updated_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s, %s::numeric, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (event_id) DO UPDATE SET
                      user_id = COALESCE(EXCLUDED.user_id, payment_orders.user_id),
                      phone = EXCLUDED.phone,
                      tier = EXCLUDED.tier,
                      billing_cycle = EXCLUDED.billing_cycle,
                      status = EXCLUDED.status,
                      amount_cents = EXCLUDED.amount_cents,
                      provider = EXCLUDED.provider,
                      created_at_unix = EXCLUDED.created_at_unix,
                      raw = EXCLUDED.raw,
                      trace_id = COALESCE(EXCLUDED.trace_id, payment_orders.trace_id),
                      request_id = COALESCE(EXCLUDED.request_id, payment_orders.request_id),
                      currency = EXCLUDED.currency,
                      provider_order_id = COALESCE(EXCLUDED.provider_order_id, payment_orders.provider_order_id),
                      channel = EXCLUDED.channel,
                      paid_at = COALESCE(EXCLUDED.paid_at, payment_orders.paid_at),
                      failed_at = COALESCE(EXCLUDED.failed_at, payment_orders.failed_at),
                      refunded_at = COALESCE(EXCLUDED.refunded_at, payment_orders.refunded_at),
                      last_status_change_at = NOW(),
                      raw_schema_version = COALESCE(NULLIF(EXCLUDED.raw_schema_version, ''), payment_orders.raw_schema_version),
                      settlement_amount_cents = COALESCE(EXCLUDED.settlement_amount_cents, payment_orders.settlement_amount_cents),
                      settlement_currency = COALESCE(EXCLUDED.settlement_currency, payment_orders.settlement_currency),
                      fx_rate_snapshot = COALESCE(EXCLUDED.fx_rate_snapshot, payment_orders.fx_rate_snapshot),
                      refunded_amount_cents = COALESCE(EXCLUDED.refunded_amount_cents, payment_orders.refunded_amount_cents),
                      idempotency_key = COALESCE(EXCLUDED.idempotency_key, payment_orders.idempotency_key),
                      client_request_id = COALESCE(EXCLUDED.client_request_id, payment_orders.client_request_id),
                      product_snapshot = CASE
                        WHEN EXCLUDED.product_snapshot = '{}'::jsonb THEN payment_orders.product_snapshot
                        ELSE EXCLUDED.product_snapshot
                      END,
                      amount_subtotal_cents = COALESCE(EXCLUDED.amount_subtotal_cents, payment_orders.amount_subtotal_cents),
                      discount_cents = EXCLUDED.discount_cents,
                      tax_cents = EXCLUDED.tax_cents,
                      payable_cents = COALESCE(EXCLUDED.payable_cents, payment_orders.payable_cents),
                      paid_cents = COALESCE(EXCLUDED.paid_cents, payment_orders.paid_cents),
                      source_ip = COALESCE(EXCLUDED.source_ip, payment_orders.source_ip),
                      user_agent = COALESCE(EXCLUDED.user_agent, payment_orders.user_agent),
                      updated_at = NOW()
                    """,
                    (
                        eid,
                        uid,
                        p,
                        t,
                        bc,
                        st,
                        int(amount_cents or 0),
                        pv,
                        ct,
                        json.dumps(payload, ensure_ascii=False),
                        tid,
                        rid,
                        cur_code,
                        poid,
                        ch,
                        paid_at,
                        failed_at,
                        refunded_at,
                        "v2",
                        settle_amount,
                        settle_currency,
                        fx_rate,
                        refunded_amount,
                        idk,
                        crid,
                        json.dumps(snapshot, ensure_ascii=False),
                        subtotal_cents,
                        discount_val,
                        tax_val,
                        payable_val,
                        paid_val,
                        src_ip,
                        ua,
                    ),
                )

                tx_type = "refund" if st in {"refunded", "partially_refunded"} else "payment"
                provider_tx_id = poid or rid or f"{eid}:{st}"
                tx_occurred_at = refunded_at if tx_type == "refund" else (paid_at or failed_at or effective_at)
                cur.execute(
                    """
                    INSERT INTO payment_transactions
                      (order_event_id, provider, transaction_type, transaction_status, amount_cents, currency, provider_transaction_id, idempotency_key, client_request_id, occurred_at, trace_id, request_id, raw, updated_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (provider, provider_transaction_id) DO UPDATE SET
                      transaction_status = EXCLUDED.transaction_status,
                      amount_cents = EXCLUDED.amount_cents,
                      currency = EXCLUDED.currency,
                      idempotency_key = COALESCE(EXCLUDED.idempotency_key, payment_transactions.idempotency_key),
                      client_request_id = COALESCE(EXCLUDED.client_request_id, payment_transactions.client_request_id),
                      occurred_at = COALESCE(EXCLUDED.occurred_at, payment_transactions.occurred_at),
                      trace_id = COALESCE(EXCLUDED.trace_id, payment_transactions.trace_id),
                      request_id = COALESCE(EXCLUDED.request_id, payment_transactions.request_id),
                      raw = EXCLUDED.raw,
                      updated_at = NOW()
                    """,
                    (
                        eid,
                        pv,
                        tx_type,
                        st,
                        int(refunded_amount or amount_cents or 0) if tx_type == "refund" else int(amount_cents or 0),
                        cur_code,
                        provider_tx_id,
                        idk,
                        crid,
                        tx_occurred_at,
                        tid,
                        rid,
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )

                if items:
                    cur.execute("DELETE FROM payment_order_items WHERE order_event_id = %s", (eid,))
                    line_no = 0
                    for item in items:
                        line_no += 1
                        qty = max(1, int(item.get("quantity") or 1))
                        unit_price = max(0, int(item.get("unit_price_cents") or 0))
                        line_subtotal = max(0, int(item.get("line_subtotal_cents") or (qty * unit_price)))
                        item_discount = max(0, int(item.get("discount_cents") or 0))
                        item_tax = max(0, int(item.get("tax_cents") or 0))
                        item_payable = max(0, int(item.get("payable_cents") or (line_subtotal - item_discount + item_tax)))
                        cur.execute(
                            """
                            INSERT INTO payment_order_items
                              (order_event_id, line_no, product_id, sku, name, unit_price_cents, quantity, line_subtotal_cents, discount_cents, tax_cents, payable_cents, raw, updated_at)
                            VALUES
                              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                            """,
                            (
                                eid,
                                line_no,
                                (str(item.get("product_id") or "").strip() or None),
                                (str(item.get("sku") or "").strip() or None),
                                (str(item.get("name") or "").strip() or None),
                                unit_price,
                                qty,
                                line_subtotal,
                                item_discount,
                                item_tax,
                                item_payable,
                                json.dumps(item, ensure_ascii=False),
                            ),
                        )

                if is_payg and st == "paid":
                    try:
                        mval = float(snapshot.get("minutes") or 0)
                    except (TypeError, ValueError):
                        mval = 0.0
                    if mval > 0:
                        try:
                            exp_days = int(snapshot.get("expires_days") or 90)
                        except (TypeError, ValueError):
                            exp_days = 90
                        exp_days = max(1, min(exp_days, 3650))
                        exp_at = effective_at + timedelta(days=exp_days)
                        cur.execute(
                            """
                            INSERT INTO user_payg_minute_grants
                              (user_id, phone, minutes, minutes_remaining, expires_at, payment_event_id)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (payment_event_id) DO NOTHING
                            """,
                            (uid, p, mval, mval, exp_at, eid),
                        )

                if is_wallet and st == "paid":
                    credit = int(amount_cents or 0)
                    snap_topup = snapshot.get("topup_cents")
                    if snap_topup is not None:
                        try:
                            if int(snap_topup) != credit:
                                credit = 0
                        except (TypeError, ValueError):
                            credit = 0
                    if credit > 0:
                        cur.execute(
                            """
                            INSERT INTO user_wallet_topups (payment_event_id, user_id, phone, amount_cents)
                            VALUES (%s, %s, %s, %s)
                            ON CONFLICT (payment_event_id) DO NOTHING
                            RETURNING payment_event_id
                            """,
                            (eid, uid, p, credit),
                        )
                        if cur.fetchone():
                            cur.execute(
                                """
                                INSERT INTO user_wallet_balance (user_id, phone, balance_cents, updated_at)
                                VALUES (%s, %s, %s, NOW())
                                ON CONFLICT (user_id) DO UPDATE SET
                                  balance_cents = user_wallet_balance.balance_cents + EXCLUDED.balance_cents,
                                  phone = EXCLUDED.phone,
                                  updated_at = NOW()
                                """,
                                (uid, p, credit),
                            )

                if st in {"refunded", "partially_refunded"}:
                    rid_refund = (refund_id or "").strip() or f"{eid}:auto"
                    slice_refund = int(refunded_amount or amount_cents or 0)
                    cur.execute(
                        """
                        INSERT INTO payment_refunds
                          (order_event_id, provider, refund_id, refund_status, refunded_amount_cents, currency, refunded_at, reason, trace_id, request_id, raw, updated_at)
                          VALUES
                          (%s, %s, %s, 'processed', %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                        ON CONFLICT (provider, refund_id) DO NOTHING
                        RETURNING id
                        """,
                        (
                            eid,
                            pv,
                            rid_refund,
                            slice_refund,
                            cur_code,
                            refunded_at,
                            (refund_reason or "").strip() or None,
                            tid,
                            rid,
                            json.dumps(payload, ensure_ascii=False),
                        ),
                    )
                    refund_inserted = cur.fetchone() is not None
                    if refund_inserted and is_wallet and slice_refund > 0:
                        cur.execute(
                            """
                            INSERT INTO user_wallet_balance (user_id, phone, balance_cents, updated_at)
                            VALUES (%s, %s, 0, NOW())
                            ON CONFLICT (user_id) DO NOTHING
                            """,
                            (uid, p),
                        )
                        cur.execute(
                            """
                            UPDATE user_wallet_balance
                            SET balance_cents = GREATEST(0, balance_cents - %s),
                                phone = %s,
                                updated_at = NOW()
                            WHERE user_id = %s
                            """,
                            (slice_refund, p, uid),
                        )
                    cur.execute(
                        "SELECT COALESCE(SUM(refunded_amount_cents), 0) AS total_refund FROM payment_refunds WHERE order_event_id = %s",
                        (eid,),
                    )
                    total_refund = int((cur.fetchone() or {}).get("total_refund") or 0)
                    if total_refund < int(amount_cents or 0):
                        cur.execute(
                            "UPDATE payment_orders SET status = 'partially_refunded', refunded_amount_cents = %s, updated_at = NOW() WHERE event_id = %s",
                            (total_refund, eid),
                        )
                    else:
                        cur.execute(
                            "UPDATE payment_orders SET status = 'refunded', refunded_amount_cents = %s, updated_at = NOW() WHERE event_id = %s",
                            (total_refund, eid),
                        )

                if not skip_subscription_side_effects:
                    cur.execute(
                        """
                        INSERT INTO subscription_events
                          (user_id, phone, tier, event_type, billing_cycle, effective_at, expires_at, order_event_id, trace_id, request_id, source, actor_phone, meta, created_at)
                        VALUES
                          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                        ON CONFLICT DO NOTHING
                        """,
                        (
                            uid,
                            p,
                            t,
                            et,
                            bc,
                            effective_at,
                            None,
                            eid,
                            tid,
                            rid,
                            src,
                            ap,
                            json.dumps(event_meta, ensure_ascii=False),
                        ),
                    )

                    _upsert_subscription_current_state_with_conn(
                        conn,
                        phone=p,
                        tier=t,
                        billing_cycle=bc,
                        status=_state_status_from_event_type(et, t),
                        effective_at=effective_at,
                        expires_at=None,
                        source=src,
                        order_event_id=eid,
                    )
            conn.commit()
            return True
    except Exception:
        return False


def get_payment_order_by_event_id(event_id: str) -> dict[str, Any] | None:
    """按商户订单号（event_id / out_trade_no）读取 payment_orders 一行；供退款通知关联原单。"""
    eid = (event_id or "").strip()
    if not eid:
        return None
    try:
        ensure_payment_orders_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    SELECT event_id, user_id, phone, tier, billing_cycle, status, amount_cents, provider,
                           product_snapshot, currency, channel, provider_order_id
                    FROM payment_orders
                    WHERE event_id = %s
                    LIMIT 1
                    """,
                    (eid,),
                )
                row = cur.fetchone()
        if not row:
            return None
        return dict(row)
    except Exception:
        return None


def payment_refund_exists(provider: str, refund_id: str) -> bool:
    pv = (provider or "").strip() or "unknown"
    rid = (refund_id or "").strip()
    if not rid:
        return False
    try:
        ensure_payment_refunds_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    "SELECT 1 FROM payment_refunds WHERE provider = %s AND refund_id = %s LIMIT 1",
                    (pv, rid),
                )
                return cur.fetchone() is not None
    except Exception:
        return False


def sum_refunded_cents_for_order(order_event_id: str) -> int:
    eid = (order_event_id or "").strip()
    if not eid:
        return 0
    try:
        ensure_payment_refunds_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(refunded_amount_cents), 0)::bigint AS s FROM payment_refunds WHERE order_event_id = %s",
                    (eid,),
                )
                r = cur.fetchone() or {}
                return int(r.get("s") or 0)
    except Exception:
        return 0


def list_payment_orders_for_phone(phone: str, limit: int = 40) -> list[dict[str, Any]]:
    p = (phone or "").strip()
    lim = max(1, min(100, int(limit)))
    if not p:
        return []
    try:
        ensure_payment_orders_schema()
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _ensure_user_id_for_phone_conn(conn, p)
                cur.execute(
                    """
                    SELECT
                      event_id, phone, tier, billing_cycle, status, amount_cents, provider, created_at_unix, created_at,
                      currency, channel, provider_order_id, refunded_amount_cents,
                      payable_cents, paid_cents, amount_subtotal_cents, discount_cents, tax_cents
                    FROM payment_orders
                    WHERE (user_id = %s OR phone = %s)
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (uid, p, lim),
                )
                rows = [dict(x) for x in cur.fetchall() or []]
                return rows
    except Exception:
        return []


# ========== 站点级 app_settings（如 TTS 润色条款） ==========
APP_SETTING_TTS_POLISH_DUAL = "tts_polish_dual_requirements"
APP_SETTING_TTS_POLISH_SINGLE = "tts_polish_single_requirements"
_APP_SETTING_MAX_CHARS = 12_000


def ensure_app_settings_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()


def app_setting_get(key: str) -> str | None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = %s LIMIT 1", (key,))
            row = cur.fetchone()
            if not row:
                return None
            v = row.get("value")
            return str(v) if v is not None else None


def app_setting_upsert(key: str, value: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET
                  value = EXCLUDED.value,
                  updated_at = NOW();
                """,
                (key, value),
            )
            conn.commit()


def app_setting_delete(key: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM app_settings WHERE key = %s", (key,))
            conn.commit()


def get_tts_polish_requirement_overrides() -> dict[str, str | None]:
    """若库中无记录或为空字符串，返回 None 表示使用 minimax 内置默认。"""
    ensure_app_settings_schema()
    d_raw = app_setting_get(APP_SETTING_TTS_POLISH_DUAL)
    s_raw = app_setting_get(APP_SETTING_TTS_POLISH_SINGLE)
    d = d_raw.strip() if d_raw and d_raw.strip() else None
    s = s_raw.strip() if s_raw and s_raw.strip() else None
    return {"dual": d, "single": s}


def save_tts_polish_prompts(dual: str, single: str) -> tuple[bool, str]:
    d = (dual or "").strip()
    s = (single or "").strip()
    if len(d) > _APP_SETTING_MAX_CHARS or len(s) > _APP_SETTING_MAX_CHARS:
        return False, f"单字段不超过 {_APP_SETTING_MAX_CHARS} 字"
    ensure_app_settings_schema()
    app_setting_upsert(APP_SETTING_TTS_POLISH_DUAL, d)
    app_setting_upsert(APP_SETTING_TTS_POLISH_SINGLE, s)
    return True, ""


def reset_tts_polish_prompts() -> None:
    ensure_app_settings_schema()
    app_setting_delete(APP_SETTING_TTS_POLISH_DUAL)
    app_setting_delete(APP_SETTING_TTS_POLISH_SINGLE)
