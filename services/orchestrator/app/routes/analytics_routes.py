from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth_bridge, models
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"], dependencies=[Depends(verify_internal_signature)])


class VisitorRequest(BaseModel):
    visitor_id: str = Field(..., min_length=8, max_length=128)
    device_visitor_id: str = Field(..., min_length=8, max_length=128)


def _normalize_device_visitor_id(value: str | None) -> str | None:
    vid = (value or "").strip()
    if len(vid) < 8 or len(vid) > 128:
        return None
    return vid


@router.post("/visitor")
def record_site_visitor_api(request: Request, body: VisitorRequest):
    """记录站点 UV：仅 device_visitor_id；上海日历日每设备一条。"""
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
    )
    return {"success": True}
