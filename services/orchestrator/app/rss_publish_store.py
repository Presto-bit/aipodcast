import json
import uuid
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any
from xml.sax.saxutils import escape

from .db import get_conn, get_cursor
from .media_wallet import media_wallet_billing_enabled
from .models import get_job, list_job_events
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
    """任务流水中出现「套餐外按次/钱包」扣费记录（与 worker 写入的 log 文案一致）。"""
    for ev in list_job_events(job_id, after_id=0):
        msg = str(ev.get("message") or "")
        if "已按预估语音分钟结算套餐外用量" not in msg:
            continue
        pay = _event_payload_dict(ev.get("event_payload"))
        if int(pay.get("wallet_cents") or 0) > 0:
            return True
        if float(pay.get("from_payg_minutes") or 0) > 0:
            return True
    return False


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
    RSS 发布条件：
    - 账户：订阅档 Basic+、按量 payg、或免费档但账户内有余额（充值用户）；
    - 作品：上述付费/按量档位的成片均可；免费档+余额时，需本任务曾产生套餐外扣费（钱包或按次分钟包），
      纯免费用量成片不可写 RSS。媒体钱包总开关关闭时，免费+余额无法校验扣费，允许发布。
    """
    from . import auth_bridge
    from .models import wallet_balance_cents_for_phone

    jid = (job_id or "").strip()
    row = get_job(jid, user_ref=user_phone)
    if not row:
        raise ValueError("job_not_found")
    tier = str(auth_bridge.user_info_for_phone(user_phone).get("plan") or "free").strip().lower()
    bal = max(0, int(wallet_balance_cents_for_phone(user_phone) or 0))

    if tier in ("basic", "pro", "max", "payg"):
        return
    if tier != "free":
        return
    if bal <= 0:
        raise ValueError("RSS 发布需订阅会员、按量套餐或账户有余额（充值）。")
    if not media_wallet_billing_enabled():
        return
    if _job_events_indicate_paid_media_debit(jid):
        return
    raise ValueError(
        "仅支持由付费套餐、按量套餐或余额扣费生成的成片写入 RSS；"
        "本任务为免费额度内生成，请先升级/充值后重新生成作品再发布。"
    )


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
                    (summary or "").strip(),
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
