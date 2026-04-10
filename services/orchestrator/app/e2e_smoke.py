"""CI / Playwright 用：在显式密钥保护下插入「假 succeeded 播客」并跑通 RSS，无需 MiniMax。"""

from __future__ import annotations

import io
import json
import os
import uuid
from typing import Any

from .db import get_conn, get_cursor
from .models import ensure_default_project
from .object_store import presigned_get_url, upload_bytes
from .rss_publish_store import publish_work_to_rss, upsert_rss_channel
def _e2e_smoke_login_password() -> str:
    raw = (os.getenv("E2E_SMOKE_LOGIN_PASSWORD") or "").strip()
    if len(raw) >= 8:
        return raw
    return "E2eSmoke!ci900"


def _ensure_e2e_smoke_login_password(cur, user_id: str) -> None:
    from werkzeug.security import generate_password_hash

    pw = _e2e_smoke_login_password()
    h = generate_password_hash(pw)
    cur.execute(
        """
        INSERT INTO user_auth_accounts (user_id, password_hash, status, updated_at)
        VALUES (%s::uuid, %s, 'active', NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
        """,
        (user_id, h),
    )


def e2e_smoke_secret_configured() -> bool:
    return bool((os.getenv("E2E_SMOKE_SECRET") or "").strip())


def verify_e2e_secret(token: str | None) -> bool:
    sec = (os.getenv("E2E_SMOKE_SECRET") or "").strip()
    if not sec:
        return False
    t = (token or "").strip()
    if not t:
        return False
    import hmac

    return hmac.compare_digest(sec, t)


def _silent_mp3_bytes() -> bytes:
    from pydub import AudioSegment  # type: ignore

    buf = io.BytesIO()
    AudioSegment.silent(duration=2200, frame_rate=44100).export(buf, format="mp3", bitrate="128k")
    return buf.getvalue()


def run_smoke_chain() -> dict[str, Any]:
    """
    返回 source_job_id, channel_id, user_phone, feed_slug（若成功）。
    """
    phone = "+8619980019900"
    mp3 = _silent_mp3_bytes()
    hx = mp3.hex()

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO users (phone, display_name, role, updated_at)
                VALUES (%s, %s, 'user', NOW())
                ON CONFLICT (phone) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
                RETURNING id::text
                """,
                (phone, "E2E Smoke"),
            )
            urow = cur.fetchone()
            user_id = str(urow["id"]) if urow and urow.get("id") else ""
            conn.commit()

    project_id = ensure_default_project("e2e-smoke", phone)
    fixture_running_job_id = str(uuid.uuid4())
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            _ensure_e2e_smoke_login_password(cur, user_id)
            cur.execute(
                """
                INSERT INTO jobs (
                  id, project_id, job_type, status, queue_name, payload, result,
                  progress, created_by, started_at
                )
                VALUES (
                  %s::uuid, %s::uuid, 'podcast', 'running', 'media', '{}'::jsonb, '{}'::jsonb,
                  42, %s::uuid, NOW()
                )
                """,
                (fixture_running_job_id, project_id, user_id),
            )
            conn.commit()
    audio_key = f"e2e/smoke/{uuid.uuid4().hex}/episode.mp3"
    cover_key = f"e2e/smoke/{uuid.uuid4().hex}/cover.jpg"
    upload_bytes(audio_key, mp3, "audio/mpeg")
    tiny_jpg = (
        b"\xff\xd8\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c"
        b"\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' \",#\x1c\x1c(7),01444\x1f\'9=82<.7\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14"
        b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xaa\xff\xd9"
    )
    upload_bytes(cover_key, tiny_jpg, "image/jpeg")
    audio_url = presigned_get_url(audio_key, expires_in=86400)
    src_result = {
        "title": "E2E Smoke Episode",
        "preview": "端到端冒烟测试用单集。",
        "script_text": "这是 E2E 测试文稿。第一句。第二句。第三句收束。",
        "audio_hex": hx,
        "audio_object_key": audio_key,
        "audio_url": audio_url,
        "audio_duration_sec": 3,
        "cover_object_key": cover_key,
        "cover_content_type": "image/jpeg",
        "cover_image": "/api/jobs/placeholder/cover",
    }
    src_id = str(uuid.uuid4())
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO jobs (
                  id, project_id, job_type, status, queue_name, payload, result,
                  progress, created_by, completed_at, started_at
                )
                VALUES (
                  %s::uuid, %s::uuid, 'podcast', 'succeeded', 'media', '{}'::jsonb, %s::jsonb,
                  100, %s::uuid, NOW(), NOW()
                )
                """,
                (src_id, project_id, json.dumps(src_result), user_id),
            )
            conn.commit()

    ch = upsert_rss_channel(
        phone,
        {
            "title": "E2E Smoke Feed",
            "description": "CI",
            "author": "e2e",
            "language": "zh-cn",
            "image_url": "",
        },
    )
    cid = str(ch.get("id") or "")
    pub = publish_work_to_rss(
        phone,
        cid,
        src_id,
        title="E2E Published",
        summary="smoke",
        show_notes="## E2E\n\nhello",
        explicit=False,
        publish_at=None,
        force_republish=True,
    )
    return {
        "ok": True,
        "source_job_id": src_id,
        "channel_id": cid,
        "user_phone": phone,
        "feed_slug": str(ch.get("feed_slug") or ""),
        "rss": pub,
        "fixture_running_job_id": fixture_running_job_id,
    }
