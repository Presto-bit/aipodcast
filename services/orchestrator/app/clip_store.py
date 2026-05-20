"""文稿剪辑工程：PG 存元数据与转写结果，音频/导出在对象存储。"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from .db import get_conn, get_cursor

logger = logging.getLogger(__name__)


def ensure_clip_studio_schema(*, strict: bool) -> None:
    """与 init/025_clip_studio.sql 对齐；已有库通过启动 DDL 补齐。"""
    ddl = """
    CREATE TABLE IF NOT EXISTS clip_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '未命名剪辑',
      audio_object_key TEXT,
      audio_filename TEXT,
      audio_mime TEXT,
      audio_size_bytes BIGINT,
      transcription_status TEXT NOT NULL DEFAULT 'idle',
      dashscope_task_id TEXT,
      transcription_error TEXT,
      transcript_raw_json JSONB,
      transcript_normalized JSONB,
      excluded_word_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      diarization_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      speaker_count INTEGER NOT NULL DEFAULT 2,
      channel_ids JSONB NOT NULL DEFAULT '[0]'::jsonb,
      export_status TEXT NOT NULL DEFAULT 'idle',
      export_object_key TEXT,
      export_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_clip_projects_user_created ON clip_projects(user_id, created_at DESC);
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS audio_staging_keys jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS suggestion_feedback jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS silence_analysis jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS timeline_json jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS studio_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS collaboration_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS retake_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS qc_report jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS export_pause_policy jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS rough_cut_lexicon_exempt jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS asr_corpus_hotwords jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS asr_corpus_scene text;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS repair_loudness_i_lufs double precision;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS export_options jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS audio_source_segments jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS audio_segment_transcripts jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS audio_merge_status text NOT NULL DEFAULT 'idle';
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS audio_merge_error text;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS shownotes_markdown TEXT;
    ALTER TABLE clip_projects
      ADD COLUMN IF NOT EXISTS project_kind TEXT NOT NULL DEFAULT 'clip';
    UPDATE clip_projects
    SET project_kind = 'shownotes'
    WHERE project_kind = 'clip' AND trim(title) = 'Shownotes';
    """
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(ddl)
            conn.commit()
    except Exception:
        logger.exception("ensure_clip_studio_schema failed")
        if strict:
            raise


def _parse_uuid(s: str | None) -> str | None:
    if not (s or "").strip():
        return None
    try:
        return str(uuid.UUID(str(s).strip()))
    except (ValueError, TypeError, AttributeError):
        return None


def insert_clip_project(*, user_uuid: str | None, title: str, project_kind: str = "clip") -> str:
    tid = (title or "").strip() or "未命名剪辑"
    kind = (project_kind or "clip").strip().lower() or "clip"
    if kind not in ("clip", "shownotes"):
        kind = "clip"
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO clip_projects (user_id, title, project_kind)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (uid, tid, kind),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row["id"])


def list_clip_projects(
    *,
    user_uuid: str | None,
    limit: int = 50,
    offset: int = 0,
    project_kind: str | None = None,
    sort: str = "updated",
) -> list[dict[str, Any]]:
    uid = _parse_uuid(user_uuid)
    lim = max(1, min(200, int(limit)))
    off = max(0, int(offset))
    kind = (project_kind or "").strip().lower() or None
    if kind and kind not in ("clip", "shownotes"):
        kind = None
    order_sql = (
        "ORDER BY created_at DESC NULLS LAST, updated_at DESC"
        if (sort or "").strip().lower() == "created"
        else "ORDER BY updated_at DESC NULLS LAST, created_at DESC"
    )
    kind_clause = "AND project_kind = %s" if kind else ""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            base_select = f"""
                    SELECT id, title, project_kind, transcription_status, export_status,
                           created_at, updated_at, audio_filename,
                           audio_object_key IS NOT NULL AS has_audio,
                           (
                             audio_object_key IS NOT NULL
                             OR jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) > 0
                             OR jsonb_array_length(COALESCE(audio_staging_keys, '[]'::jsonb)) > 0
                           ) AS has_material
                    FROM clip_projects
                    WHERE {{user_clause}}
                    {kind_clause}
                    {order_sql}
                    LIMIT %s OFFSET %s
                    """
            if uid:
                user_clause = "user_id = %s::uuid"
                params: list[Any] = [uid]
                if kind:
                    params.append(kind)
                params.extend([lim, off])
                cur.execute(base_select.format(user_clause=user_clause), tuple(params))
            else:
                user_clause = "user_id IS NULL"
                params = []
                if kind:
                    params.append(kind)
                params.extend([lim, off])
                cur.execute(base_select.format(user_clause=user_clause), tuple(params))
            return [dict(r) for r in cur.fetchall()]


def get_clip_project_by_id(project_id: str) -> dict[str, Any] | None:
    """Worker 内部使用：仅按 id 读取（不做用户隔离）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM clip_projects WHERE id = %s::uuid LIMIT 1", (pid,))
            row = cur.fetchone()
            return dict(row) if row else None


def get_clip_project(*, project_id: str, user_uuid: str | None) -> dict[str, Any] | None:
    pid = _parse_uuid(project_id)
    if not pid:
        return None
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    SELECT * FROM clip_projects
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    LIMIT 1
                    """,
                    (pid, uid),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM clip_projects
                    WHERE id = %s::uuid AND user_id IS NULL
                    LIMIT 1
                    """,
                    (pid,),
                )
            row = cur.fetchone()
            return dict(row) if row else None


def set_clip_audio_merge_state(
    *,
    project_id: str,
    user_uuid: str | None,
    status: str,
    error: str | None = None,
) -> bool:
    """idle | queued | running | failed — 异步合并进度（仅编排器写入）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    st = (status or "idle").strip().lower()
    if st not in ("idle", "queued", "running", "failed"):
        st = "idle"
    err = (error or "").strip()[:2000] if error else None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_merge_status = %s, audio_merge_error = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (st, err, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_merge_status = %s, audio_merge_error = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (st, err, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_project_audio(
    *,
    project_id: str,
    user_uuid: str | None,
    object_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
    source_segments: list[dict[str, Any]] | None = None,
    preserve_segment_transcript_cache: bool = False,
) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    if source_segments is None:
        seg_blob = json.dumps(
            [
                {
                    "key": (object_key or "").strip(),
                    "filename": (filename or "")[:500],
                    "mime": (mime or "")[:200],
                    "size_bytes": int(size_bytes),
                }
            ],
            ensure_ascii=False,
        )
    else:
        seg_blob = json.dumps(source_segments, ensure_ascii=False)
    seg_tr_set = (
        ", audio_segment_transcripts = '{}'::jsonb"
        if not preserve_segment_transcript_cache
        else ""
    )
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    f"""
                UPDATE clip_projects
                SET audio_object_key = %s, audio_filename = %s, audio_mime = %s, audio_size_bytes = %s,
                        audio_staging_keys = '[]'::jsonb,
                        audio_source_segments = %s::jsonb{seg_tr_set},
                        transcription_status = 'idle', dashscope_task_id = NULL, transcription_error = NULL,
                        transcript_raw_json = NULL, transcript_normalized = NULL,
                        excluded_word_ids = '[]'::jsonb,
                        silence_analysis = NULL,
                        timeline_json = NULL,
                        studio_snapshots = '[]'::jsonb,
                        collaboration_notes = '[]'::jsonb,
                        retake_manifest = '[]'::jsonb,
                        qc_report = NULL,
                        export_status = 'idle', export_object_key = NULL, export_error = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (object_key, filename[:500], mime[:200], int(size_bytes), seg_blob, pid, uid),
                )
            else:
                cur.execute(
                    f"""
                UPDATE clip_projects
                SET audio_object_key = %s, audio_filename = %s, audio_mime = %s, audio_size_bytes = %s,
                        audio_staging_keys = '[]'::jsonb,
                        audio_source_segments = %s::jsonb{seg_tr_set},
                        transcription_status = 'idle', dashscope_task_id = NULL, transcription_error = NULL,
                        transcript_raw_json = NULL, transcript_normalized = NULL,
                        excluded_word_ids = '[]'::jsonb,
                        silence_analysis = NULL,
                        timeline_json = NULL,
                        studio_snapshots = '[]'::jsonb,
                        collaboration_notes = '[]'::jsonb,
                        retake_manifest = '[]'::jsonb,
                        qc_report = NULL,
                        export_status = 'idle', export_object_key = NULL, export_error = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (object_key, filename[:500], mime[:200], int(size_bytes), seg_blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def remove_clip_segment_transcript_cache_keys(
    *,
    project_id: str,
    user_uuid: str | None,
    keys: list[str],
) -> bool:
    """从 audio_segment_transcripts 中删除指定 object_key（用于仅重转勾选段）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    drop = {str(k).strip() for k in keys if str(k).strip()}
    if not drop:
        return True
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    raw = row.get("audio_segment_transcripts")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    for k in drop:
        raw.pop(k, None)
    blob = json.dumps(raw, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            conn.commit()
            return cur.rowcount > 0


def clear_clip_audio_segment_transcripts(*, project_id: str, user_uuid: str | None) -> bool:
    """清空分段转写缓存（单文件替换或强制全量重转写时调用）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = '{}'::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = '{}'::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (pid,),
                )
            conn.commit()
            return cur.rowcount > 0


def prune_clip_audio_segment_transcripts(
    *,
    project_id: str,
    user_uuid: str | None,
    keep_keys: list[str],
) -> bool:
    """仅保留仍存在于工程中的分段 object_key 对应的转写缓存。"""
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    raw = row.get("audio_segment_transcripts")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    want = {str(k).strip() for k in keep_keys if str(k).strip()}
    pruned = {k: v for k, v in raw.items() if isinstance(k, str) and k in want}
    pid = _parse_uuid(project_id)
    uid = _parse_uuid(user_uuid)
    if not pid:
        return False
    blob = json.dumps(pruned, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_segment_transcripts = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            conn.commit()
            return True


def set_clip_audio_source_segments(
    *, project_id: str, user_uuid: str | None, segments: list[dict[str, Any]]
) -> bool:
    """写入 audio_source_segments 整表（须为带 key 的 dict 列表）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    blob = json.dumps(segments, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def rename_clip_audio_source_segment(
    *,
    project_id: str,
    user_uuid: str | None,
    object_key: str,
    filename: str,
) -> bool:
    """仅改某分段的展示文件名（不改对象键）。"""
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    want = str(object_key or "").strip()
    if not want:
        return False
    st = row.get("audio_source_segments")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return False
    new_list: list[dict[str, Any]] = []
    hit = False
    fn = (filename or "").strip()[:500] or "audio"
    for it in st:
        if not isinstance(it, dict):
            continue
        k = str(it.get("key") or "").strip()
        if not k:
            continue
        d = dict(it)
        if k == want:
            d["filename"] = fn
            hit = True
        new_list.append(d)
    if not hit:
        return False
    pid = _parse_uuid(project_id)
    uid = _parse_uuid(user_uuid)
    blob = json.dumps(new_list, ensure_ascii=False)
    main_key = str(row.get("audio_object_key") or "").strip()
    single = len(new_list) == 1 and main_key and new_list[0].get("key") == main_key
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                if single:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET audio_source_segments = %s::jsonb,
                            audio_filename = %s,
                            updated_at = NOW()
                        WHERE id = %s::uuid AND user_id = %s::uuid
                        """,
                        (blob, fn, pid, uid),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET audio_source_segments = %s::jsonb, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id = %s::uuid
                        """,
                        (blob, pid, uid),
                    )
            else:
                if single:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET audio_source_segments = %s::jsonb,
                            audio_filename = %s,
                            updated_at = NOW()
                        WHERE id = %s::uuid AND user_id IS NULL
                        """,
                        (blob, fn, pid),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET audio_source_segments = %s::jsonb, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id IS NULL
                        """,
                        (blob, pid),
                    )
            n = cur.rowcount
            conn.commit()
            return n > 0


def remove_clip_audio_source_segment_from_list(
    *, project_id: str, user_uuid: str | None, object_key: str
) -> tuple[bool, list[dict[str, Any]]]:
    """
    从 audio_source_segments 中移除一段并写回 DB。
    返回 (是否找到并更新, 更新后的列表)。
    """
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False, []
    want = str(object_key or "").strip()
    if not want:
        return False, []
    st = row.get("audio_source_segments")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return False, []
    new_list = [dict(x) for x in st if isinstance(x, dict) and str(x.get("key") or "").strip() != want]
    if len(new_list) == len(st):
        return False, []
    ok = set_clip_audio_source_segments(project_id=project_id, user_uuid=user_uuid, segments=new_list)
    return ok, new_list


def clear_clip_project_audio_material_completely(*, project_id: str, user_uuid: str | None) -> bool:
    """清空主音频与分段、转写与相关缓存（与「无素材」一致）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = NULL, audio_filename = NULL, audio_mime = NULL, audio_size_bytes = NULL,
                        audio_staging_keys = '[]'::jsonb,
                        audio_source_segments = '[]'::jsonb,
                        audio_segment_transcripts = '{}'::jsonb,
                        transcription_status = 'idle', dashscope_task_id = NULL, transcription_error = NULL,
                        transcript_raw_json = NULL, transcript_normalized = NULL,
                        excluded_word_ids = '[]'::jsonb,
                        silence_analysis = NULL,
                        timeline_json = NULL,
                        studio_snapshots = '[]'::jsonb,
                        collaboration_notes = '[]'::jsonb,
                        retake_manifest = '[]'::jsonb,
                        qc_report = NULL,
                        export_status = 'idle', export_object_key = NULL, export_error = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = NULL, audio_filename = NULL, audio_mime = NULL, audio_size_bytes = NULL,
                        audio_staging_keys = '[]'::jsonb,
                        audio_source_segments = '[]'::jsonb,
                        audio_segment_transcripts = '{}'::jsonb,
                        transcription_status = 'idle', dashscope_task_id = NULL, transcription_error = NULL,
                        transcript_raw_json = NULL, transcript_normalized = NULL,
                        excluded_word_ids = '[]'::jsonb,
                        silence_analysis = NULL,
                        timeline_json = NULL,
                        studio_snapshots = '[]'::jsonb,
                        collaboration_notes = '[]'::jsonb,
                        retake_manifest = '[]'::jsonb,
                        qc_report = NULL,
                        export_status = 'idle', export_object_key = NULL, export_error = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (pid,),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def replace_clip_source_audio_preserve_transcript(
    *,
    project_id: str,
    user_uuid: str | None,
    object_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
) -> bool:
    """仅替换主素材文件；保留转写稿、排除词等剪辑状态；清空静音缓存与质检缓存。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            seg_blob = json.dumps(
                [
                    {
                        "key": (object_key or "").strip(),
                        "filename": (filename or "")[:500],
                        "mime": (mime or "")[:200],
                        "size_bytes": int(size_bytes),
                    }
                ],
                ensure_ascii=False,
            )
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = %s, audio_filename = %s, audio_mime = %s, audio_size_bytes = %s,
                        audio_source_segments = %s::jsonb,
                        audio_segment_transcripts = '{}'::jsonb,
                        silence_analysis = NULL,
                        qc_report = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (object_key, filename[:500], mime[:200], int(size_bytes), seg_blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = %s, audio_filename = %s, audio_mime = %s, audio_size_bytes = %s,
                        audio_source_segments = %s::jsonb,
                        audio_segment_transcripts = '{}'::jsonb,
                        silence_analysis = NULL,
                        qc_report = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (object_key, filename[:500], mime[:200], int(size_bytes), seg_blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_export_pause_policy(
    *,
    project_id: str,
    user_uuid: str | None,
    policy: dict[str, Any] | None,
) -> bool:
    """粗剪：导出时是否压缩超长词间静音。policy 为 None 表示关闭。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    if policy is None:
        blob = None
    elif isinstance(policy, dict):
        blob = json.dumps(policy, ensure_ascii=False)
    else:
        return False
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_pause_policy = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_pause_policy = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_rough_cut_lexicon_exempt(
    *,
    project_id: str,
    user_uuid: str | None,
    phrases: list[str],
) -> bool:
    """嘉宾名 / 公司名 / 专业词：不视为口癖；存为小写归一化后的去重短串数组。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    seen: set[str] = set()
    clean: list[str] = []
    for p in phrases:
        s = str(p or "").strip()[:64]
        if not s or len(s) < 1:
            continue
        key = s.lower() if s.isascii() and any(c.isalpha() for c in s) else s
        if key in seen:
            continue
        seen.add(key)
        clean.append(s[:64])
        if len(clean) >= 200:
            break
    blob = json.dumps(clean, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET rough_cut_lexicon_exempt = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET rough_cut_lexicon_exempt = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_asr_corpus(
    *,
    project_id: str,
    user_uuid: str | None,
    hotwords: list[str],
    scene: str | None,
) -> bool:
    """火山录音识别 request.corpus：热词直传 + 可选场景上下文（dialog_ctx）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    seen: set[str] = set()
    clean_hw: list[str] = []
    for p in hotwords:
        s = str(p or "").strip()[:48]
        if not s or len(s) < 1:
            continue
        if s in seen:
            continue
        seen.add(s)
        clean_hw.append(s)
        if len(clean_hw) >= 500:
            break
    hw_blob = json.dumps(clean_hw, ensure_ascii=False)
    scene_sql: str | None = (scene or "").strip()[:3500] or None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET asr_corpus_hotwords = %s::jsonb,
                        asr_corpus_scene = %s,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (hw_blob, scene_sql, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET asr_corpus_hotwords = %s::jsonb,
                        asr_corpus_scene = %s,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (hw_blob, scene_sql, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_repair_loudness_i_lufs(
    *,
    project_id: str,
    user_uuid: str | None,
    i_lufs: float | None,
) -> bool:
    """修音 / 导出 loudnorm 目标整合响度 I（LUFS）；NULL 表示使用环境变量 CLIP_EXPORT_LOUDNORM_I 或默认 -16。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                if i_lufs is None:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET repair_loudness_i_lufs = NULL, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id = %s::uuid
                        """,
                        (pid, uid),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET repair_loudness_i_lufs = %s, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id = %s::uuid
                        """,
                        (float(i_lufs), pid, uid),
                    )
            else:
                if i_lufs is None:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET repair_loudness_i_lufs = NULL, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id IS NULL
                        """,
                        (pid,),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE clip_projects
                        SET repair_loudness_i_lufs = %s, updated_at = NOW()
                        WHERE id = %s::uuid AND user_id IS NULL
                        """,
                        (float(i_lufs), pid),
                    )
            n = cur.rowcount
            conn.commit()
            return n > 0


def append_clip_audio_staging(
    *,
    project_id: str,
    user_uuid: str | None,
    object_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
) -> bool:
    """向 audio_staging_keys 追加一段；上限由环境 CLIP_MAX_STAGING_SEGMENTS（默认 32）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    max_seg = max(1, min(128, int(os.getenv("CLIP_MAX_STAGING_SEGMENTS") or "32")))
    entry = {
        "key": (object_key or "").strip(),
        "filename": (filename or "")[:500],
        "mime": (mime or "")[:200],
        "size_bytes": int(size_bytes),
    }
    if not entry["key"]:
        return False
    blob = json.dumps([entry], ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_staging_keys = COALESCE(audio_staging_keys, '[]'::jsonb) || %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND jsonb_array_length(COALESCE(audio_staging_keys, '[]'::jsonb)) < %s
                    """,
                    (blob, pid, uid, max_seg),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_staging_keys = COALESCE(audio_staging_keys, '[]'::jsonb) || %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND jsonb_array_length(COALESCE(audio_staging_keys, '[]'::jsonb)) < %s
                    """,
                    (blob, pid, max_seg),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def prepend_current_main_as_source_segment_if_empty_sources(
    *,
    project_id: str,
    user_uuid: str | None,
    main_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
) -> bool:
    """
    当已有主音频但 audio_source_segments 与 staging 均为空时，将当前主音插入分段列表首位，
    以便后续追加分段时与旧主音一并合并（兼容升级前仅有 audio_object_key 的工程）。
    """
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    mk = (main_key or "").strip()
    if not mk:
        return False
    entry = {
        "key": mk,
        "filename": (filename or "")[:500],
        "mime": (mime or "")[:200],
        "size_bytes": int(size_bytes),
    }
    blob = json.dumps([entry], ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb || COALESCE(audio_source_segments, '[]'::jsonb),
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND audio_object_key IS NOT NULL AND TRIM(audio_object_key) <> ''
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) = 0
                      AND jsonb_array_length(COALESCE(audio_staging_keys, '[]'::jsonb)) = 0
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb || COALESCE(audio_source_segments, '[]'::jsonb),
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND audio_object_key IS NOT NULL AND TRIM(audio_object_key) <> ''
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) = 0
                      AND jsonb_array_length(COALESCE(audio_staging_keys, '[]'::jsonb)) = 0
                    """,
                    (blob, pid),
                )
            conn.commit()
            return True


def append_clip_audio_source_segment(
    *,
    project_id: str,
    user_uuid: str | None,
    object_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
) -> bool:
    """向 audio_source_segments 追加一段（与暂存条结构一致）；上限同 CLIP_MAX_STAGING_SEGMENTS。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    max_seg = max(1, min(128, int(os.getenv("CLIP_MAX_STAGING_SEGMENTS") or "32")))
    entry = {
        "key": (object_key or "").strip(),
        "filename": (filename or "")[:500],
        "mime": (mime or "")[:200],
        "size_bytes": int(size_bytes),
    }
    if not entry["key"]:
        return False
    blob = json.dumps([entry], ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = COALESCE(audio_source_segments, '[]'::jsonb) || %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) < %s
                    """,
                    (blob, pid, uid, max_seg),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = COALESCE(audio_source_segments, '[]'::jsonb) || %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) < %s
                    """,
                    (blob, pid, max_seg),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def reorder_clip_audio_source_segments(*, project_id: str, user_uuid: str | None, ordered_keys: list[str]) -> bool:
    """按 ordered_keys 重写 audio_source_segments；须与当前 key 集合为同一多重集。"""
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    st = row.get("audio_source_segments")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return False
    current: list[dict[str, Any]] = []
    for it in st:
        if isinstance(it, dict) and str(it.get("key") or "").strip():
            current.append(it)
    want = [str(k).strip() for k in ordered_keys if str(k).strip()]
    cur_keys = [str(d["key"]) for d in current]
    if not current or len(want) != len(cur_keys) or set(want) != set(cur_keys):
        return False
    key_to_entry: dict[str, dict[str, Any]] = {str(d["key"]): d for d in current}
    try:
        new_list = [key_to_entry[k] for k in want]
    except KeyError:
        return False
    pid = _parse_uuid(project_id)
    uid = _parse_uuid(user_uuid)
    if not pid:
        return False
    blob = json.dumps(new_list, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_source_segments = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def reorder_clip_audio_staging(*, project_id: str, user_uuid: str | None, ordered_keys: list[str]) -> bool:
    """
    按 ordered_keys 重写 audio_staging_keys 顺序；ordered_keys 须与当前暂存 key 集合一致（同一多重集）。
    """
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    st = row.get("audio_staging_keys")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return False
    current: list[dict[str, Any]] = []
    for it in st:
        if isinstance(it, dict) and str(it.get("key") or "").strip():
            current.append(it)
    want = [str(k).strip() for k in ordered_keys if str(k).strip()]
    cur_keys = [str(d["key"]) for d in current]
    if not current or len(want) != len(cur_keys) or set(want) != set(cur_keys):
        return False
    key_to_entry: dict[str, dict[str, Any]] = {str(d["key"]): d for d in current}
    try:
        new_list = [key_to_entry[k] for k in want]
    except KeyError:
        return False
    pid = _parse_uuid(project_id)
    uid = _parse_uuid(user_uuid)
    if not pid:
        return False
    blob = json.dumps(new_list, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_staging_keys = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_staging_keys = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def try_claim_clip_transcription_queued(
    *,
    project_id: str,
    user_uuid: str | None,
    allow_retry_from_succeeded: bool = False,
) -> bool:
    """
    将转写状态原子置为 queued（须已有主轨 object_key 或非空 audio_source_segments），防止重复入队。
    allow_retry_from_succeeded：partial 补转写等场景允许从 succeeded 再次入队。
    """
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    statuses = ["idle", "failed"]
    if allow_retry_from_succeeded:
        statuses = ["idle", "failed", "succeeded"]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET transcription_status = 'queued', dashscope_task_id = NULL,
                        transcription_error = NULL, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND (
                        (audio_object_key IS NOT NULL AND btrim(audio_object_key) <> '')
                        OR jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) > 0
                      )
                      AND transcription_status = ANY(%s::text[])
                    """,
                    (pid, uid, statuses),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET transcription_status = 'queued', dashscope_task_id = NULL,
                        transcription_error = NULL, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND (
                        (audio_object_key IS NOT NULL AND btrim(audio_object_key) <> '')
                        OR jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) > 0
                      )
                      AND transcription_status = ANY(%s::text[])
                    """,
                    (pid, statuses),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def revert_clip_transcription_after_enqueue_failed(
    *, project_id: str, user_uuid: str | None, restore_status: str
) -> bool:
    """入队失败时将 queued 恢复为 idle、failed 或 succeeded（restore_status 须为三者之一）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    rs = (restore_status or "").strip().lower()
    if rs not in ("idle", "failed", "succeeded"):
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET transcription_status = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid AND transcription_status = 'queued'
                    """,
                    (rs, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET transcription_status = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL AND transcription_status = 'queued'
                    """,
                    (rs, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def try_claim_clip_export_queued(*, project_id: str, user_uuid: str | None) -> bool:
    """转写已成功时，将导出从 idle/failed/succeeded 原子置为 queued，防止重复入队。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_status = 'queued', export_error = NULL, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND transcription_status = 'succeeded'
                      AND export_status IN ('idle', 'failed', 'succeeded')
                    """,
                    (pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_status = 'queued', export_error = NULL, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND transcription_status = 'succeeded'
                      AND export_status IN ('idle', 'failed', 'succeeded')
                    """,
                    (pid,),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def revert_clip_export_after_enqueue_failed(
    *, project_id: str, user_uuid: str | None, restore_status: str
) -> bool:
    """restore_status 须为 idle|failed|succeeded。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    rs = (restore_status or "").strip().lower()
    if rs not in ("idle", "failed", "succeeded"):
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_status = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid AND export_status = 'queued'
                    """,
                    (rs, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET export_status = %s, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL AND export_status = 'queued'
                    """,
                    (rs, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_transcribe_queued(*, project_id: str, user_uuid: str | None, task_id: str) -> bool:
    pid = _parse_uuid(project_id)
    tid = (task_id or "").strip()
    if not pid or not tid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET transcription_status = 'running', dashscope_task_id = %s,
                    transcription_error = NULL, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [tid, pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_transcribe_succeeded(
    *,
    project_id: str,
    user_uuid: str | None,
    raw: dict[str, Any] | None,
    normalized: dict[str, Any],
    segment_transcripts: dict[str, Any] | None = None,
) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    seg_sql = ""
    if segment_transcripts is not None:
        seg_sql = ", audio_segment_transcripts = %s::jsonb"
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = f"""
                UPDATE clip_projects
                SET transcription_status = 'succeeded',
                    transcript_raw_json = %s::jsonb,
                    transcript_normalized = %s::jsonb
                    {seg_sql},
                    transcription_error = NULL,
                    updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [json.dumps(raw or {}), json.dumps(normalized)]
            if segment_transcripts is not None:
                params.append(json.dumps(segment_transcripts, ensure_ascii=False))
            params.append(pid)
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_transcribe_failed(*, project_id: str, user_uuid: str | None, message: str) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    msg = (message or "")[:4000]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET transcription_status = 'failed', transcription_error = %s, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [msg, pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_transcript_normalized_only(
    *,
    project_id: str,
    user_uuid: str | None,
    normalized: dict[str, Any],
) -> bool:
    """仅更新 transcript_normalized（重排后按分段缓存重拼稿面，不动转写状态）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET transcript_normalized = %s::jsonb, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [json.dumps(normalized, ensure_ascii=False), pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def clear_clip_merged_main_audio_when_using_segments(
    *,
    project_id: str,
    user_uuid: str | None,
) -> bool:
    """
    存在非空 audio_source_segments 时清空合并主轨字段（方案三：编辑期不保留整轨 object key）。
    """
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = NULL,
                        audio_filename = NULL,
                        audio_mime = NULL,
                        audio_size_bytes = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) > 0
                    """,
                    (pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET audio_object_key = NULL,
                        audio_filename = NULL,
                        audio_mime = NULL,
                        audio_size_bytes = NULL,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                      AND jsonb_array_length(COALESCE(audio_source_segments, '[]'::jsonb)) > 0
                    """,
                    (pid,),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_shownotes_markdown(*, project_id: str, user_uuid: str | None, markdown: str) -> bool:
    """首页 / Shownotes 工作台：持久化 Markdown（与作品详情 Shownotes 同源编辑上限）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    md = (markdown or "")[:20_000]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET shownotes_markdown = %s,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (md, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET shownotes_markdown = %s,
                        updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (md, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_project_meta(
    *,
    project_id: str,
    user_uuid: str | None,
    title: str | None = None,
    diarization_enabled: bool | None = None,
    speaker_count: int | None = None,
    channel_ids: list[int] | None = None,
) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    sets: list[str] = []
    vals: list[Any] = []
    if title is not None:
        sets.append("title = %s")
        vals.append((title or "").strip()[:200] or "未命名剪辑")
    if diarization_enabled is not None:
        sets.append("diarization_enabled = %s")
        vals.append(bool(diarization_enabled))
    if speaker_count is not None:
        sets.append("speaker_count = %s")
        vals.append(max(1, min(8, int(speaker_count))))
    if channel_ids is not None:
        sets.append("channel_ids = %s::jsonb")
        vals.append(json.dumps([int(x) for x in channel_ids]))
    if not sets:
        return True
    vals.extend([pid])
    sql = f"UPDATE clip_projects SET {', '.join(sets)}, updated_at = NOW() WHERE id = %s::uuid"
    if uid:
        sql += " AND user_id = %s::uuid"
        vals.append(uid)
    else:
        sql += " AND user_id IS NULL"
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(sql, tuple(vals))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_project_export_options(
    *, project_id: str, user_uuid: str | None, export_options: dict[str, Any]
) -> bool:
    """写入导出选项（提交导出任务前由 API 调用）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    blob = json.dumps(export_options if isinstance(export_options, dict) else {}, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET export_options = %s::jsonb, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [blob, pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_excluded_words(*, project_id: str, user_uuid: str | None, word_ids: list[str]) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    clean = [str(x).strip() for x in word_ids if str(x).strip()][:100000]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET excluded_word_ids = %s::jsonb, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [json.dumps(clean), pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def append_clip_suggestion_feedback(
    *,
    project_id: str,
    user_uuid: str | None,
    event: dict[str, Any],
) -> bool:
    """向 suggestion_feedback 追加一条事件（用于反哺词表与 prompt 分析）；最多保留 400 条。"""
    pid = _parse_uuid(project_id)
    if not pid or not isinstance(event, dict):
        return False
    uid = _parse_uuid(user_uuid)
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    fb = row.get("suggestion_feedback")
    if isinstance(fb, str):
        try:
            fb = json.loads(fb)
        except Exception:
            fb = []
    if not isinstance(fb, list):
        fb = []
    fb = [*fb, event][-400:]
    blob = json.dumps(fb, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET suggestion_feedback = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects
                    SET suggestion_feedback = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_timeline_json(*, project_id: str, user_uuid: str | None, timeline: dict[str, Any] | None) -> bool:
    """写入精剪时间线 JSON（客户端可覆盖服务端推导）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    val = json.dumps(timeline or {}, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET timeline_json = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (val, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET timeline_json = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (val, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def append_studio_snapshot(*, project_id: str, user_uuid: str | None, snapshot: dict[str, Any]) -> bool:
    """追加工程快照（含 excluded 与时间线副本），最多 30 条。"""
    pid = _parse_uuid(project_id)
    if not pid or not isinstance(snapshot, dict):
        return False
    uid = _parse_uuid(user_uuid)
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    snaps = row.get("studio_snapshots")
    if isinstance(snaps, str):
        try:
            snaps = json.loads(snaps)
        except Exception:
            snaps = []
    if not isinstance(snaps, list):
        snaps = []
    entry = dict(snapshot)
    entry.setdefault("id", str(uuid.uuid4()))
    snaps = [*snaps, entry][-30:]
    blob = json.dumps(snaps, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET studio_snapshots = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET studio_snapshots = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def append_collaboration_note(*, project_id: str, user_uuid: str | None, note: dict[str, Any]) -> bool:
    """协作备注（单用户场景下为时间轴批注），最多 200 条。"""
    pid = _parse_uuid(project_id)
    if not pid or not isinstance(note, dict):
        return False
    uid = _parse_uuid(user_uuid)
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    notes = row.get("collaboration_notes")
    if isinstance(notes, str):
        try:
            notes = json.loads(notes)
        except Exception:
            notes = []
    if not isinstance(notes, list):
        notes = []
    entry = dict(note)
    body = str(entry.get("body") or "").strip()
    if not body:
        return False
    entry["body"] = body[:4000]
    entry.setdefault("id", str(uuid.uuid4()))
    entry.setdefault("author", "editor")
    notes = [*notes, entry][-200:]
    blob = json.dumps(notes, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET collaboration_notes = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET collaboration_notes = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def replace_retake_manifest(*, project_id: str, user_uuid: str | None, manifest: list[dict[str, Any]]) -> bool:
    """整表替换重录槽（含 takes 对象键）；条数与 takes 长度做硬上限。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    clean: list[dict[str, Any]] = []
    for i, it in enumerate((manifest or [])[:60]):
        if not isinstance(it, dict):
            continue
        slot = {
            "id": str(it.get("id") or "").strip() or str(uuid.uuid4()),
            "after_word_id": str(it.get("after_word_id") or "").strip(),
            "label": str(it.get("label") or f"重录 {i + 1}")[:200],
            "status": str(it.get("status") or "pending").strip()[:32],
            "takes": [],
        }
        takes_raw = it.get("takes") if isinstance(it.get("takes"), list) else []
        for tk in takes_raw[:12]:
            if not isinstance(tk, dict):
                continue
            k = str(tk.get("object_key") or "").strip()
            if not k:
                continue
            dm: int | None = None
            try:
                dm = int(float(tk.get("duration_ms")))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                pass
            slot["takes"].append(
                {
                    "object_key": k[:500],
                    "filename": str(tk.get("filename") or "take.mp3")[:240],
                    "created_at": str(tk.get("created_at") or "")[:40],
                    "duration_ms": dm,
                }
            )
        try:
            ati = int(it.get("active_take_index", 0))
        except (TypeError, ValueError):
            ati = 0
        slot["active_take_index"] = max(0, min(len(slot["takes"]) - 1, ati)) if slot["takes"] else 0
        if slot["after_word_id"]:
            clean.append(slot)
    blob = json.dumps(clean, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET retake_manifest = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (blob, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET retake_manifest = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (blob, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def append_retake_take_slot(
    *,
    project_id: str,
    user_uuid: str | None,
    slot_id: str,
    object_key: str,
    filename: str,
    duration_ms: int | None = None,
) -> bool:
    """向指定重录槽追加一条 take（对象已上传）。"""
    pid = _parse_uuid(project_id)
    sid = (slot_id or "").strip()
    if not pid or not sid or not (object_key or "").strip():
        return False
    uid = _parse_uuid(user_uuid)
    row = get_clip_project(project_id=project_id, user_uuid=user_uuid)
    if not row:
        return False
    man = row.get("retake_manifest")
    if isinstance(man, str):
        try:
            man = json.loads(man)
        except Exception:
            man = []
    if not isinstance(man, list):
        man = []
    now = datetime.now(timezone.utc).isoformat()
    found = False
    out: list[dict[str, Any]] = []
    for slot in man:
        if not isinstance(slot, dict):
            continue
        s = dict(slot)
        if str(s.get("id") or "").strip() == sid:
            takes = s.get("takes") if isinstance(s.get("takes"), list) else []
            takes = [
                *takes,
                {
                    "object_key": object_key.strip()[:500],
                    "filename": (filename or "take.mp3")[:240],
                    "created_at": now,
                    "duration_ms": duration_ms,
                },
            ][-12:]
            s["takes"] = takes
            s["status"] = "recorded"
            s["active_take_index"] = max(0, len(takes) - 1)
            found = True
        out.append(s)
    if not found:
        return False
    return replace_retake_manifest(project_id=project_id, user_uuid=user_uuid, manifest=out)


def update_qc_report(*, project_id: str, user_uuid: str | None, report: dict[str, Any] | None) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    val = json.dumps(report or {}, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET qc_report = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (val, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET qc_report = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (val, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_silence_analysis(
    *,
    project_id: str,
    user_uuid: str | None,
    analysis: dict[str, Any] | None,
) -> bool:
    """写入 silence_analysis（含 object_key 与 segments，便于缓存）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    val = json.dumps(analysis or {}, ensure_ascii=False)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    """
                    UPDATE clip_projects SET silence_analysis = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id = %s::uuid
                    """,
                    (val, pid, uid),
                )
            else:
                cur.execute(
                    """
                    UPDATE clip_projects SET silence_analysis = %s::jsonb, updated_at = NOW()
                    WHERE id = %s::uuid AND user_id IS NULL
                    """,
                    (val, pid),
                )
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_export_running(*, project_id: str, user_uuid: str | None) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET export_status = 'running', export_error = NULL, updated_at = NOW()
                WHERE id = %s::uuid
                  AND transcription_status = 'succeeded'
                  AND export_status IN ('queued', 'idle', 'failed', 'succeeded')
                """
            params: list[Any] = [pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_export_succeeded(*, project_id: str, user_uuid: str | None, export_key: str) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET export_status = 'succeeded', export_object_key = %s, export_error = NULL, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [export_key, pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def update_clip_export_failed(*, project_id: str, user_uuid: str | None, message: str) -> bool:
    pid = _parse_uuid(project_id)
    if not pid:
        return False
    uid = _parse_uuid(user_uuid)
    msg = (message or "")[:4000]
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            sql = """
                UPDATE clip_projects
                SET export_status = 'failed', export_error = %s, updated_at = NOW()
                WHERE id = %s::uuid
                """
            params: list[Any] = [msg, pid]
            if uid:
                sql += " AND user_id = %s::uuid"
                params.append(uid)
            else:
                sql += " AND user_id IS NULL"
            cur.execute(sql, tuple(params))
            n = cur.rowcount
            conn.commit()
            return n > 0


def _retake_object_keys_from_manifest(manifest: Any) -> list[str]:
    out: list[str] = []
    if isinstance(manifest, str):
        try:
            manifest = json.loads(manifest)
        except Exception:
            return []
    if not isinstance(manifest, list):
        return []
    for slot in manifest:
        if not isinstance(slot, dict):
            continue
        for tk in slot.get("takes") or []:
            if isinstance(tk, dict) and tk.get("object_key"):
                k = str(tk["object_key"]).strip()
                if k:
                    out.append(k)
    return out


def delete_clip_project(*, project_id: str, user_uuid: str | None) -> dict[str, Any] | None:
    """删除行并返回需清理的对象键（由路由删存储）。"""
    pid = _parse_uuid(project_id)
    if not pid:
        return None
    uid = _parse_uuid(user_uuid)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if uid:
                cur.execute(
                    "SELECT audio_object_key, export_object_key, audio_staging_keys, retake_manifest FROM clip_projects WHERE id = %s::uuid AND user_id = %s::uuid",
                    (pid, uid),
                )
            else:
                cur.execute(
                    "SELECT audio_object_key, export_object_key, audio_staging_keys, retake_manifest FROM clip_projects WHERE id = %s::uuid AND user_id IS NULL",
                    (pid,),
                )
            row = cur.fetchone()
            if not row:
                return None
            st = row.get("audio_staging_keys")
            if isinstance(st, str):
                try:
                    st = json.loads(st)
                except Exception:
                    st = []
            staging_keys: list[str] = []
            if isinstance(st, list):
                for it in st:
                    if isinstance(it, dict) and it.get("key"):
                        staging_keys.append(str(it["key"]))
            retake_keys = _retake_object_keys_from_manifest(row.get("retake_manifest"))
            keys = {
                "audio_object_key": row.get("audio_object_key"),
                "export_object_key": row.get("export_object_key"),
                "staging_object_keys": staging_keys,
                "retake_object_keys": retake_keys,
            }
            if uid:
                cur.execute("DELETE FROM clip_projects WHERE id = %s::uuid AND user_id = %s::uuid", (pid, uid))
            else:
                cur.execute("DELETE FROM clip_projects WHERE id = %s::uuid AND user_id IS NULL", (pid,))
            conn.commit()
            return keys
