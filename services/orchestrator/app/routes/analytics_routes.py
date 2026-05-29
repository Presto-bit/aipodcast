from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth_bridge, models
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"], dependencies=[Depends(verify_internal_signature)])


class VisitorRequest(BaseModel):
    visitor_id: str = Field(..., min_length=8, max_length=128)


@router.post("/visitor")
def record_site_visitor_api(request: Request, body: VisitorRequest):
    """记录站点 UV：每个 visitor_id 每个 Asia/Shanghai 日历日至多一条。"""
    user_id: str | None = None
    sess = auth_bridge.get_session_by_bearer(str(request.headers.get("authorization") or ""))
    if sess:
        user_id = auth_bridge.session_principal(sess) or None
    models.record_site_visitor(visitor_id=body.visitor_id.strip(), user_id=user_id)
    return {"success": True}
