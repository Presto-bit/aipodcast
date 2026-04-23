import json
import uuid
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any
from xml.sax.saxutils import escape

from .db import get_conn, get_cursor
from .media_wallet import media_wallet_billing_enabled
from .models import (
    get_job,
    list_job_events,
    user_work_download_blocked_never_paid_free_only,
)
from .show_notes_convert import (
    markdown_show_notes_to_html,
    plain_summary_fallback_from_markdown,
    rss_cdata_fragment,
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_publish_at(value: str | None) -> datetime:
    raw = (value or "").strip()
    if not raw:
        return _now_utc()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception as exc:
        raise ValueError("invalid_publish_at") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_user_uuid_from_phone(cur: Any, phone: str | None) -> str | None:
    raw = (phone or "").strip()
    if not raw:
        return None
    cur.execute("SELECT id FROM users WHERE phone = %s LIMIT 1", (raw,))
    row = cur.fetchone()
    if row and row.get("id") is not None:
        return str(row["id"])
    return None


def ensure_rss_publish_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS rss_channels (
                  id TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  feed_slug TEXT NOT NULL UNIQUE,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '',
                  author TEXT NOT NULL DEFAULT '',
                  language TEXT NOT NULL DEFAULT 'zh-cn',
                  image_url TEXT NOT NULL DEFAULT '',
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS rss_episodes (
                  id TEXT PRIMARY KEY,
                  channel_id TEXT NOT NULL REFERENCES rss_channels(id) ON DELETE CASCADE,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                  guid TEXT NOT NULL UNIQUE,
                  title TEXT NOT NULL,
                  summary TEXT NOT NULL DEFAULT '',
                  show_notes TEXT NOT NULL DEFAULT '',
                  audio_url TEXT NOT NULL,
                  image_url TEXT NOT NULL DEFAULT '',
                  duration_sec INTEGER,
                  explicit BOOLEAN NOT NULL DEFAULT FALSE,
                  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  UNIQUE(channel_id, job_id)
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_rss_channels_user_id ON rss_channels(user_id)")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_rss_episodes_channel_time ON rss_episodes(channel_id, published_at DESC)"
            )
            conn.commit()


def list_rss_channels(user_phone: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_from_phone(cur, user_phone)
            if not user_uuid:
                return []
            cur.execute(
                """
                SELECT id, feed_slug, title, description, author, language, image_url, created_at, updated_at
                FROM rss_channels
                WHERE user_id = %s::uuid
                ORDER BY updated_at DESC, created_at DESC
                """,
                (user_uuid,),
            )
            return [dict(x) for x in cur.fetchall()]


def list_episode_publications(user_phone: str, job_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    clean_ids = [str(x or "").strip() for x in job_ids if str(x or "").strip()]
    if not clean_ids:
        return {}
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_from_phone(cur, user_phone)
            if not user_uuid:
                return {}
            cur.execute(
                """
                SELECT e.job_id::text AS job_id,
                       e.channel_id,
                       c.title AS channel_title,
                       c.feed_slug,
                       e.id AS episode_id,
                       e.title,
                       e.published_at,
                       e.created_at
                FROM rss_episodes e
                JOIN rss_channels c ON c.id = e.channel_id
                WHERE e.user_id = %s::uuid
                  AND e.job_id::text = ANY(%s)
                ORDER BY e.published_at DESC, e.created_at DESC
                """,
                (user_uuid, clean_ids),
            )
            rows = [dict(x) for x in cur.fetchall()]
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        jid = str(row.get("job_id") or "").strip()
        if not jid:
            continue
        out.setdefault(jid, []).append(row)
    return out


def upsert_rss_channel(user_phone: str, payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("title_required")
    description = str(payload.get("description") or "").strip()
    author = str(payload.get("author") or "").strip()
    language = str(payload.get("language") or "zh-cn").strip() or "zh-cn"
    image_url = str(payload.get("image_url") or "").strip()
    requested_id = str(payload.get("id") or "").strip()

    channel_id: str

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_from_phone(cur, user_phone)
            if not user_uuid:
                raise ValueError("user_not_found")
            if requested_id:
                cur.execute(
                    """
                    SELECT id
                    FROM rss_channels
                    WHERE id = %s AND user_id = %s::uuid
                    LIMIT 1
                    """,
                    (requested_id, user_uuid),
                )
                row = cur.fetchone()
                if not row or not row.get("id"):
                    raise ValueError("channel_not_found")
                channel_id = str(row["id"])
                cur.execute(
                    """
                    UPDATE rss_channels
                    SET title = %s,
                        description = %s,
                        author = %s,
                        language = %s,
                        image_url = %s,
                        updated_at = NOW()
                    WHERE id = %s AND user_id = %s::uuid
                    """,
                    (title, description, author, language, image_url, channel_id, user_uuid),
                )
            else:
                channel_id = uuid.uuid4().hex
                feed_slug = uuid.uuid4().hex[:16]
                cur.execute(
                    """
                    INSERT INTO rss_channels (
                      id, user_id, feed_slug, title, description, author, language, image_url
                    ) VALUES (%s, %s::uuid, %s, %s, %s, %s, %s, %s)
                    """,
                    (channel_id, user_uuid, feed_slug, title, description, author, language, image_url),
                )
            conn.commit()

    channels = list_rss_channels(user_phone)
    for ch in channels:
        if str(ch.get("id") or "") == channel_id:
            return ch
    raise ValueError("channel_upsert_failed")


def _event_payload_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip().startswith("{"):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return {}


def _job_events_indicate_paid_media_debit(job_id: str) -> bool:
    """任务流水中出现体验包或钱包计费记录（与 worker 写入的 log 文案一致）。"""
    markers = (
        "已按预估语音分钟结算体验包与/或钱包",
        "已按实际语音时长结算体验包与/或钱包",
        "已结算脚本文本费用",
        "已从钱包扣除单次克隆费用",
    )
    for ev in list_job_events(job_id, after_id=0):
        msg = str(ev.get("message") or "")
        if any(m in msg for m in markers):
            return True
    return False


def user_download_allowed_for_succeeded_works(user_phone: str | None) -> bool:
    """
    作品列表专用：列表中的任务均为 succeeded，下载权限只与用户账户有关，
    避免对每个 job 重复 get_job 与钱包/订阅查询。
    """
    up = (user_phone or "").strip()
    if not up:
        return False
    return not user_work_download_blocked_never_paid_free_only(up, "free")


def work_download_allowed(job_id: str, user_phone: str | None) -> bool:
    """
    是否允许打包下载本条成片：
    - 若用户从未有余额（无钱包充值记录且当前余额为 0），且历史侧证仅为 free 档，则不允许；
    - 其余情况均允许（与单条任务是否套餐外扣费无关）。
    """
    jid = (job_id or "").strip()
    up = (user_phone or "").strip()
    if not jid or not up:
        return False
    row = get_job(jid, user_ref=up)
    if not row:
        return False
    if str(row.get("status") or "") != "succeeded":
        return False
    if user_work_download_blocked_never_paid_free_only(up, "free"):
        return False
    return True


def rss_publish_eligibility_dict(user_phone: str, job_id: str) -> dict[str, Any]:
    """供 GET 预检：不抛 HTTP，返回 eligible + 说明。"""
    try:
        assert_rss_publish_eligibility(user_phone, job_id)
        return {"success": True, "eligible": True}
    except ValueError as exc:
        msg = str(exc).strip()
        if msg == "job_not_found":
            return {"success": False, "eligible": False, "detail": "找不到该作品或无权访问。"}
        return {"success": True, "eligible": False, "detail": msg}


def assert_rss_publish_eligibility(user_phone: str, job_id: str) -> None:
    """
    RSS 发布条件：成片须曾从体验包或钱包产生计费记录（与下载/滥用防护一致）。
    媒体钱包总开关关闭时不校验计费，允许发布。
    """
    jid = (job_id or "").strip()
    row = get_job(jid, user_ref=user_phone)
    if not row:
        raise ValueError("job_not_found")
    if not media_wallet_billing_enabled():
        return
    if _job_events_indicate_paid_media_debit(jid):
        return
    raise ValueError(
        "RSS 仅支持由体验包或账户余额计费生成的成片；本任务未检测到计费记录，请使用计费流程重新生成后再发布。"
    )


RSS_EPISODE_SUMMARY_MAX_CHARS = 30


def _clamp_rss_episode_summary(summary: str) -> str:
    s = (summary or "").strip()
    if len(s) <= RSS_EPISODE_SUMMARY_MAX_CHARS:
        return s
    return s[: RSS_EPISODE_SUMMARY_MAX_CHARS - 1] + "…"


def _extract_work_audio_and_cover(job_row: dict[str, Any]) -> tuple[str, str, int | None]:
    result_raw = job_row.get("result")
    if isinstance(result_raw, str):
        try:
            result = json.loads(result_raw)
        except Exception:
            result = {}
    elif isinstance(result_raw, dict):
        result = result_raw
    else:
        result = {}
    audio_url = str(result.get("audio_url") or "").strip()
    if not audio_url:
        akey = str(result.get("audio_object_key") or "").strip()
        if akey:
            try:
                from .object_store import presigned_get_url

                audio_url = presigned_get_url(akey, expires_in=86400 * 7)
            except Exception:
                audio_url = ""
    if not audio_url:
        raise ValueError("work_audio_missing")
    cover = str(result.get("cover_image") or result.get("coverImage") or "").strip()
    dur_raw = result.get("audio_duration_sec")
    duration: int | None = None
    if dur_raw is not None and str(dur_raw).strip() != "":
        try:
            d = int(float(dur_raw))
            if 0 < d < 86_400:
                duration = d
        except Exception:
            duration = None
    return audio_url, cover, duration


def publish_work_to_rss(
    user_phone: str,
    channel_id: str,
    job_id: str,
    title: str,
    summary: str,
    show_notes: str,
    explicit: bool,
    publish_at: str | None = None,
    force_republish: bool = False,
) -> dict[str, Any]:
    cid = (channel_id or "").strip()
    jid = (job_id or "").strip()
    ep_title = (title or "").strip()
    if not cid or not jid or not ep_title:
        raise ValueError("invalid_publish_args")
    row = get_job(jid, user_ref=user_phone)
    if not row:
        raise ValueError("job_not_found")
    assert_rss_publish_eligibility(user_phone, jid)
    audio_url, fallback_cover, duration = _extract_work_audio_and_cover(row)
    summary_clamped = _clamp_rss_episode_summary(summary)
    schedule_at = _parse_publish_at(publish_at)
    existing: dict[str, Any] | None = None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            user_uuid = _resolve_user_uuid_from_phone(cur, user_phone)
            if not user_uuid:
                raise ValueError("user_not_found")
            cur.execute(
                """
                SELECT id, feed_slug, image_url
                FROM rss_channels
                WHERE id = %s AND user_id = %s::uuid
                LIMIT 1
                """,
                (cid, user_uuid),
            )
            ch = cur.fetchone()
            if not ch:
                raise ValueError("channel_not_found")
            cur.execute(
                """
                SELECT id::text AS id
                FROM rss_episodes
                WHERE channel_id = %s AND job_id = %s::uuid
                LIMIT 1
                """,
                (cid, jid),
            )
            existing = cur.fetchone()
            if existing and not force_republish:
                raise ValueError("already_published_same_channel")
            episode_id = uuid.uuid4().hex
            published_at = schedule_at
            episode_guid = f"{ch['feed_slug']}:{episode_id}"
            cover = str(ch.get("image_url") or "").strip() or fallback_cover
            cur.execute(
                """
                INSERT INTO rss_episodes (
                  id, channel_id, user_id, job_id, guid, title, summary, show_notes, audio_url,
                  image_url, duration_sec, explicit, published_at
                )
                VALUES (%s, %s, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (channel_id, job_id) DO UPDATE SET
                  title = EXCLUDED.title,
                  summary = EXCLUDED.summary,
                  show_notes = EXCLUDED.show_notes,
                  audio_url = EXCLUDED.audio_url,
                  image_url = EXCLUDED.image_url,
                  duration_sec = EXCLUDED.duration_sec,
                  explicit = EXCLUDED.explicit,
                  published_at = EXCLUDED.published_at
                RETURNING id, guid, published_at
                """,
                (
                    episode_id,
                    cid,
                    user_uuid,
                    jid,
                    episode_guid,
                    ep_title,
                    summary_clamped,
                    (show_notes or "").strip(),
                    audio_url,
                    cover,
                    duration,
                    bool(explicit),
                    published_at,
                ),
            )
            out = dict(cur.fetchone() or {})
            conn.commit()
    return {
        "success": True,
        "episode_id": str(out.get("id") or ""),
        "guid": str(out.get("guid") or ""),
        "published_at": str(out.get("published_at") or ""),
        "republished": bool(existing),
    }


def build_rss_feed_xml(feed_slug: str, public_base_url: str | None = None) -> str | None:
    slug = (feed_slug or "").strip()
    if not slug:
        return None
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, title, description, author, language, image_url, updated_at
                FROM rss_channels
                WHERE feed_slug = %s
                LIMIT 1
                """,
                (slug,),
            )
            ch = cur.fetchone()
            if not ch:
                return None
            cur.execute(
                """
                SELECT guid, title, summary, show_notes, audio_url, image_url, duration_sec, explicit, published_at
                FROM rss_episodes
                WHERE channel_id = %s
                ORDER BY published_at DESC, created_at DESC
                LIMIT 300
                """,
                (str(ch["id"]),),
            )
            episodes = [dict(x) for x in cur.fetchall()]

    channel_title = escape(str(ch.get("title") or "我的播客"))
    channel_desc = escape(str(ch.get("description") or ""))
    channel_author = escape(str(ch.get("author") or ""))
    channel_lang = escape(str(ch.get("language") or "zh-cn"))
    channel_img = escape(str(ch.get("image_url") or ""))
    base = (public_base_url or "").rstrip("/")
    feed_url = f"{base}/api/rss/feed/{slug}" if base else f"/api/rss/feed/{slug}"
    channel_link = f"{base}/works" if base else "/works"
    pub_date = format_datetime(ch.get("updated_at") or _now_utc())

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        f"<title>{channel_title}</title>",
        f"<link>{escape(channel_link)}</link>",
        f"<description>{channel_desc}</description>",
        f"<language>{channel_lang}</language>",
        f"<atom:link href=\"{escape(feed_url)}\" rel=\"self\" type=\"application/rss+xml\" />",
        f"<pubDate>{escape(pub_date)}</pubDate>",
    ]
    if channel_author:
        lines.append(f"<itunes:author>{channel_author}</itunes:author>")
    if channel_img:
        lines.append(f"<itunes:image href=\"{channel_img}\" />")
        lines.append(f"<image><url>{channel_img}</url><title>{channel_title}</title><link>{escape(channel_link)}</link></image>")

    for ep in episodes:
        title = escape(str(ep.get("title") or "未命名单集"))
        notes_md = str(ep.get("show_notes") or "")
        notes_html = markdown_show_notes_to_html(notes_md)
        notes_cdata = rss_cdata_fragment(notes_html)
        sum_plain = str(ep.get("summary") or "").strip()
        if not sum_plain:
            sum_plain = plain_summary_fallback_from_markdown(notes_md)
        summary_esc = escape(sum_plain)
        audio_url = escape(str(ep.get("audio_url") or ""))
        ep_img = escape(str(ep.get("image_url") or ""))
        guid = escape(str(ep.get("guid") or ""))
        ep_pub = format_datetime(ep.get("published_at") or _now_utc())
        dur = ep.get("duration_sec")
        dur_text = ""
        if isinstance(dur, int) and dur > 0:
            h = dur // 3600
            m = (dur % 3600) // 60
            s = dur % 60
            dur_text = f"{h:02d}:{m:02d}:{s:02d}"
        # itunes:subtitle 宜短，便于 Apple Podcasts / 部分客户端列表副标题
        sub_src = sum_plain.replace("\n", " ").strip()
        sub_esc = escape((sub_src[:255] + ("…" if len(sub_src) > 255 else "")) if sub_src else "")
        sum_itunes_esc = escape(sum_plain[:4000]) if sum_plain else ""
        lines.extend(
            [
                "<item>",
                f"<title>{title}</title>",
                f"<guid isPermaLink=\"false\">{guid}</guid>",
                f"<pubDate>{escape(ep_pub)}</pubDate>",
                f"<description>{summary_esc}</description>",
            ]
        )
        if sum_itunes_esc:
            lines.append(f"<itunes:summary>{sum_itunes_esc}</itunes:summary>")
        if sub_esc:
            lines.append(f"<itunes:subtitle>{sub_esc}</itunes:subtitle>")
        lines.extend(
            [
                f"<content:encoded xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">{notes_cdata}</content:encoded>",
                f"<enclosure url=\"{audio_url}\" type=\"audio/mpeg\" />",
            ]
        )
        if ep_img:
            lines.append(f"<itunes:image href=\"{ep_img}\" />")
        if dur_text:
            lines.append(f"<itunes:duration>{dur_text}</itunes:duration>")
        lines.append(f"<itunes:explicit>{'yes' if bool(ep.get('explicit')) else 'no'}</itunes:explicit>")
        lines.append("</item>")

    lines.extend(["</channel>", "</rss>"])
    return "\n".join(lines)
