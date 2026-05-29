from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth_bridge, models
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"], dependencies=[Depends(verify_internal_signature)])


class PageViewRequest(BaseModel):
    visitor_id: str = Field(..., min_length=8, max_length=128)
    path: str = Field(default="/", max_length=512)


@router.post("/page-view")
def record_page_view_api(request: Request, body: PageViewRequest):
    """记录站点 PV 事件；UV 由按日去重 visitor_id 聚合。"""
    user_id: str | None = None
    sess = auth_bridge.get_session_by_bearer(str(request.headers.get("authorization") or ""))
    if sess:
        user_id = auth_bridge.session_principal(sess) or None
    path = (body.path or "/").strip() or "/"
    if path.startswith("/api/") or path.startswith("/_next/"):
        return {"success": True, "skipped": True}
    models.record_site_page_view(visitor_id=body.visitor_id.strip(), path=path, user_id=user_id)
    return {"success": True}
