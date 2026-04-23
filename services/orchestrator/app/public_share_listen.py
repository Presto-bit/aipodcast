"""匿名打开「发给朋友」页所需的成片试听元数据（不含 payload / 全文稿）。"""

from __future__ import annotations

import json
import logging
from typing import Any

from .models import get_job
from .object_store import presigned_get_url

logger = logging.getLogger(__name__)

_PUBLIC_JOB_TYPES = frozenset({"podcast", "podcast_generate"})

# 「我的作品」内联播放：已登录且为任务所有者；含 TTS 成片（与列表 job_type 一致）
_OWNER_MY_WORK_LISTEN_TYPES = frozenset({"podcast", "podcast_generate", "podcast_short_video", "text_to_speech", "tts"})


def _coerce_result(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            o = json.loads(raw)
            return o if isinstance(o, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def build_public_share_listen_bundle(job_id: str) -> dict[str, Any] | None:
    """
    仅成功、未删除、播客成片；返回可直链播放的音频 URL（优先已有 audio_url，否则对 object key 预签名）。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, None)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _PUBLIC_JOB_TYPES:
        return None

    result = _coerce_result(row.get("result"))
    audio_url = str(result.get("audio_url") or "").strip()
    if not audio_url:
        key = str(result.get("audio_object_key") or "").strip()
        if key:
            try:
                audio_url = presigned_get_url(key, expires_in=86400 * 7)
            except Exception:
                logger.warning("public_share_listen presign failed job_id=%s", jid, exc_info=True)
                audio_url = ""
    if not audio_url:
        return None

    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"

    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None

    preview = str(result.get("preview") or result.get("script_preview") or "").strip()
    if len(preview) > 500:
        preview = preview[:499] + "…"

    chapters = result.get("audio_chapters")
    safe_chapters: list[dict[str, Any]] = []
    if isinstance(chapters, list):
        for o in chapters[:32]:
            if not isinstance(o, dict):
                continue
            safe_chapters.append(
                {
                    "title": str(o.get("title") or "章节")[:200],
                    "start_ms": int(o.get("start_ms") or 0),
                }
            )

    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
        "preview": preview,
        "audio_chapters": safe_chapters,
    }


def build_podcast_template_listen_bundle(job_id: str) -> dict[str, Any] | None:
    """
    已标记为全站创作模板的播客成片：登录用户可试听，不含 payload / 全文稿。
    """
    from .models import ensure_jobs_trash_schema

    ensure_jobs_trash_schema()
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, None)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if not bool(row.get("is_podcast_template")):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _PUBLIC_JOB_TYPES:
        return None
    result = _coerce_result(row.get("result"))
    audio_url = str(result.get("audio_url") or "").strip()
    if not audio_url:
        key = str(result.get("audio_object_key") or "").strip()
        if key:
            try:
                audio_url = presigned_get_url(key, expires_in=86400 * 7)
            except Exception:
                logger.warning("podcast_template_listen presign failed job_id=%s", jid, exc_info=True)
                audio_url = ""
    if not audio_url:
        return None
    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"
    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None
    preview = str(result.get("preview") or result.get("script_preview") or "").strip()
    if len(preview) > 500:
        preview = preview[:499] + "…"
    chapters = result.get("audio_chapters")
    safe_chapters: list[dict[str, Any]] = []
    if isinstance(chapters, list):
        for o in chapters[:32]:
            if not isinstance(o, dict):
                continue
            safe_chapters.append(
                {
                    "title": str(o.get("title") or "章节")[:200],
                    "start_ms": int(o.get("start_ms") or 0),
                }
            )
    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
        "preview": preview,
        "audio_chapters": safe_chapters,
    }


def build_owner_work_listen_bundle(job_id: str, user_ref: str | None) -> dict[str, Any] | None:
    """
    已登录用户播放「我的作品」：校验任务归属后返回可播放 URL。
    成片若仅存对象键（result 已剥离 audio_hex）或预签名过期，则按 audio_object_key 重新签发。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, user_ref)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _OWNER_MY_WORK_LISTEN_TYPES:
        return None

    result = _coerce_result(row.get("result"))
    key = str(result.get("audio_object_key") or "").strip()
    audio_url = ""
    if key:
        try:
            audio_url = presigned_get_url(key, expires_in=86400 * 7)
        except Exception:
            logger.warning("owner_work_listen presign failed job_id=%s", jid, exc_info=True)
            audio_url = ""
    if not audio_url:
        audio_url = str(result.get("audio_url") or "").strip()
    if not audio_url:
        return None

    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"

    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None

    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
    }


def build_owner_work_listen_bundle(job_id: str, user_ref: str | None) -> dict[str, Any] | None:
    """
    已登录用户播放「我的作品」：校验任务归属后返回可播放 URL。
    成片若仅存对象键（result 已剥离 audio_hex）或预签名过期，则按 audio_object_key 重新签发。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, user_ref)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _OWNER_MY_WORK_LISTEN_TYPES:
        return None

    result = _coerce_result(row.get("result"))
    key = str(result.get("audio_object_key") or "").strip()
    audio_url = ""
    if key:
        try:
            audio_url = presigned_get_url(key, expires_in=86400 * 7)
        except Exception:
            logger.warning("owner_work_listen presign failed job_id=%s", jid, exc_info=True)
            audio_url = ""
    if not audio_url:
        audio_url = str(result.get("audio_url") or "").strip()
    if not audio_url:
        return None

    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"

    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None

    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
    }
