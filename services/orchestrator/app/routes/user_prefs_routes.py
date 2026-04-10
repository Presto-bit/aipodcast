from fastapi import APIRouter, Depends, HTTPException, Request

from .. import auth_bridge
from ..models import get_user_preferences_for_phone, merge_user_preferences_for_phone
from ..schemas import UserPreferencesPatchRequest
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1/user", tags=["user"], dependencies=[Depends(verify_internal_signature)])


def _current_phone_or_401(request: Request) -> str:
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=401, detail="未登录")
    auth = str(request.headers.get("authorization") or "").strip()
    sess = auth_bridge.get_session_by_bearer(auth)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


@router.get("/preferences")
def get_user_preferences_api(request: Request):
    phone = _current_phone_or_401(request)
    data = get_user_preferences_for_phone(phone)
    return {"success": True, "data": data}


@router.patch("/preferences")
def patch_user_preferences_api(request: Request, body: UserPreferencesPatchRequest):
    phone = _current_phone_or_401(request)
    ok, err = merge_user_preferences_for_phone(phone, dict(body.data or {}))
    if not ok:
        raise HTTPException(status_code=400, detail=err or "保存失败")
    return {"success": True, "data": get_user_preferences_for_phone(phone)}
