from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response

from .. import auth_bridge
from ..rss_publish_store import (
    build_rss_feed_xml,
    list_rss_channels,
    list_episode_publications,
    publish_work_to_rss,
    upsert_rss_channel,
)
from ..schemas import RssChannelUpsertRequest, RssPublishRequest
from ..security import verify_internal_signature

private_router = APIRouter(
    prefix="/api/v1/rss",
    tags=["rss"],
    dependencies=[Depends(verify_internal_signature)],
)
public_router = APIRouter(prefix="/api/v1/rss", tags=["rss-public"], dependencies=[Depends(verify_internal_signature)])


def _current_phone_or_401(request: Request) -> str:
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


@private_router.get("/channels")
def list_channels_api(request: Request):
    phone = _current_phone_or_401(request)
    rows = list_rss_channels(phone)
    return {"success": True, "channels": rows}


@private_router.post("/channels")
def upsert_channel_api(request: Request, body: RssChannelUpsertRequest):
    phone = _current_phone_or_401(request)
    try:
        row = upsert_rss_channel(phone, dict(body.model_dump() or {}))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "channel": row}


@private_router.post("/publish")
def publish_rss_api(request: Request, body: RssPublishRequest):
    phone = _current_phone_or_401(request)
    try:
        out = publish_work_to_rss(
            user_phone=phone,
            channel_id=body.channel_id,
            job_id=body.job_id,
            title=body.title,
            summary=body.summary,
            show_notes=body.show_notes,
            explicit=bool(body.explicit),
            publish_at=body.publish_at,
            force_republish=bool(body.force_republish),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return out


@private_router.get("/publications")
def publications_api(request: Request, job_ids: str = ""):
    phone = _current_phone_or_401(request)
    parts = [x.strip() for x in str(job_ids or "").split(",") if x.strip()]
    out = list_episode_publications(phone, parts)
    return {"success": True, "items": out}


@public_router.get("/feed/{feed_slug}")
def rss_feed_api(feed_slug: str, x_public_base_url: str | None = Header(default=None, alias="x-public-base-url")):
    xml = build_rss_feed_xml(feed_slug, public_base_url=x_public_base_url)
    if not xml:
        raise HTTPException(status_code=404, detail="feed_not_found")
    return Response(
        content=xml,
        media_type="application/rss+xml; charset=utf-8",
        headers={"cache-control": "public, max-age=60"},
    )
