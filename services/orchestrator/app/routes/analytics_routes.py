from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth_bridge, models
from ..fyv_shared import auth_service
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"], dependencies=[Depends(verify_internal_signature)])


class VisitorRequest(BaseModel):
    visitor_id: str = Field(..., min_length=8, max_length=128)
    device_visitor_id: str = Field(..., min_length=8, max_length=128)
    path: str = Field(default="/", max_length=512)
    uv_zone: str = Field(default="other", max_length=32)


class FunnelRequest(BaseModel):
    step: str = Field(..., min_length=2, max_length=64)
    status: str = Field(default="succeeded", max_length=32)
    device_visitor_id: str | None = Field(default=None, max_length=128)
    meta: dict[str, str] = Field(default_factory=dict)


def _normalize_device_visitor_id(value: str | None) -> str | None:
    vid = (value or "").strip()
    if len(vid) < 8 or len(vid) > 128:
        return None
    return vid


def _normalize_uv_zone(value: str | None) -> str | None:
    zone = (value or "").strip().lower()
    if zone in ("marketing", "workbench", "other"):
        return zone
    return "other"


@router.post("/visitor")
def record_site_visitor_api(request: Request, body: VisitorRequest):
    """记录站点 UV：仅 device_visitor_id；上海日历日每设备每 zone 一条。"""
    zone = _normalize_uv_zone(body.uv_zone)
    if zone is None:
        return {"success": True, "skipped": True, "reason": "admin_excluded"}
    user_id: str | None = None
    sess = auth_bridge.get_session_by_bearer(str(request.headers.get("authorization") or ""))
    if sess:
        user_id = auth_bridge.session_principal(sess) or None
    device_vid = _normalize_device_visitor_id(body.device_visitor_id)
    if not device_vid:
        return {"success": False, "reason": "device_visitor_id_required"}
    models.record_site_visitor(
        visitor_id=body.visitor_id.strip(),
        device_visitor_id=device_vid,
        user_id=user_id,
        path=body.path.strip() or "/",
        uv_zone=zone,
    )
    return {"success": True}


@router.post("/funnel")
def record_funnel_event_api(request: Request, body: FunnelRequest):
    """记录转化漏斗事件（usage_events）。"""
    user_id: str | None = None
    sess = auth_bridge.get_session_by_bearer(str(request.headers.get("authorization") or ""))
    if sess:
        uid = str(auth_service.session_effective_user_id(sess) or "").strip()
        if uid:
            user_id = uid
    device_vid = _normalize_device_visitor_id(body.device_visitor_id)
    status = (body.status or "succeeded").strip().lower() or "succeeded"
    if status not in ("succeeded", "failed", "cancelled"):
        status = "succeeded"
    meta = {str(k): str(v) for k, v in (body.meta or {}).items()}
    models.record_funnel_event(
        step=body.step.strip(),
        status=status,
        device_visitor_id=device_vid,
        user_id=user_id,
        meta=meta,
    )
    return {"success": True}
