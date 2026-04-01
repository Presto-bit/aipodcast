import time

from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas import AuthLoginRequest, AuthProfilePatchRequest, AuthRegisterRequest, AuthUnlockFeatureRequest
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models

router = APIRouter(prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(verify_internal_signature)])


def bearer_token(request: Request) -> str:
    auth = str(request.headers.get("authorization") or "").strip()
    if not auth.startswith("Bearer "):
        return ""
    return auth[7:].strip()


@router.get("/config")
def auth_config_api():
    return {"success": True, **auth_bridge.auth_config_dict()}


@router.post("/register")
def auth_register_api(body: AuthRegisterRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    phone = body.phone.strip()
    token, err = auth_bridge.register_user(phone, body.password, body.invite_code.strip())
    if err or not token:
        raise HTTPException(status_code=400, detail=err or "注册失败")
    return {"success": True, "token": token, "user": auth_bridge.user_info_for_phone(phone)}


@router.post("/login")
def auth_login_api(body: AuthLoginRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    phone = body.phone.strip()
    token, err = auth_bridge.login_user(phone, body.password)
    if err or not token:
        raise HTTPException(status_code=400, detail=err or "登录失败")
    # 记录登录成功事件（供后台看板统计活跃/登录）
    models.record_usage_event(
        job_id=None,
        phone=phone,
        job_type="auth_login",
        metric="auth_login",
        status="succeeded",
        quantity=1,
        meta={"auth_method": "password"},
    )
    return {"success": True, "token": token, "user": auth_bridge.user_info_for_phone(phone)}


@router.post("/logout")
def auth_logout_api(request: Request):
    token = bearer_token(request)
    if token:
        auth_bridge.delete_session(token)
    return {"success": True}


@router.patch("/profile")
def auth_profile_patch_api(request: Request, body: AuthProfilePatchRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    ok, err = auth_bridge.update_display_name(phone, body.display_name.strip())
    if not ok:
        raise HTTPException(status_code=400, detail=err or "更新失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(phone)}


@router.get("/me")
def auth_me_api(request: Request):
    if not auth_bridge.is_auth_enabled():
        return {"success": True, "user": {"phone": "local", "plan": "free", "display_name": "访客"}}
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    return {"success": True, "user": auth_bridge.user_info_for_phone(str(sess.get("phone") or ""))}


@router.get("/status")
def auth_status_api(request: Request):
    if not auth_bridge.is_auth_enabled():
        return {"success": True, "feature_unlocked": True, "feature_expires_in_sec": None}
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    sess = auth_bridge.get_session(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    now = time.time()
    fu = sess.get("feature_unlock_expires")
    unlocked = bool(sess.get("feature_unlocked")) and (not fu or now <= float(fu))
    left = max(0, int(float(fu) - now)) if unlocked and fu else None
    return {"success": True, "feature_unlocked": unlocked, "feature_expires_in_sec": left}


@router.post("/unlock_feature")
def auth_unlock_feature_api(request: Request, body: AuthUnlockFeatureRequest):
    if not auth_bridge.is_auth_enabled():
        return {"success": True}
    token = bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    ok, err = auth_bridge.unlock_feature(token, body.phone.strip(), body.password)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "验证失败")
    return {"success": True}
