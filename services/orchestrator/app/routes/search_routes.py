from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..security import verify_internal_signature
from .. import auth_bridge
from ..models import search_global

router = APIRouter(prefix="/api/v1", tags=["search"], dependencies=[Depends(verify_internal_signature)])


@router.get("/search")
def search_api(request: Request, q: str = Query(default=""), limit: int = Query(default=40, ge=1, le=80)):
    user_ref: str | None = None
    if auth_bridge.is_auth_enabled():
        sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
        if not sess:
            raise HTTPException(status_code=401, detail="未登录")
        phone = auth_bridge.session_principal(sess)
        if not phone:
            raise HTTPException(status_code=401, detail="未登录")
        user_ref = phone
    data = search_global(q, limit, user_ref=user_ref)
    return {"success": True, **data}
