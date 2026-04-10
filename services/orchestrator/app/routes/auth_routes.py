import time

from fastapi import APIRouter, Depends, HTTPException, Request

from ..fyv_shared.register_send_code_limiter import (
    check_register_send_code_rate_limit,
    client_ip_from_request,
)

from ..schemas import (
    AuthForgotPasswordRequest,
    AuthLoginRequest,
    AuthProfilePatchRequest,
    AuthRegisterCompleteRequest,
    AuthRegisterRequest,
    AuthRegisterSendCodeRequest,
    AuthRegisterVerifyCodeRequest,
    AuthResetPasswordRequest,
    AuthUnlockFeatureRequest,
    AuthVerifyEmailRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..fyv_shared.auth_service import (
    request_password_reset_by_email,
    reset_password_with_token,
    verify_email_token,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(verify_internal_signature)])


def bearer_token(request: Request) -> str:
    auth = str(request.headers.get("authorization") or "").strip()
    if not auth.startswith("Bearer "):
        return ""
    return auth[7:].strip()


@router.get("/config")
def auth_config_api():
    return {"success": True, **auth_bridge.auth_config_dict()}


@router.post("/register/send-code")
def auth_register_send_code_api(request: Request, body: AuthRegisterSendCodeRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    peer = request.client.host if request.client else None
    ip = client_ip_from_request(dict(request.headers), peer)
    ok_rl, wait = check_register_send_code_rate_limit(ip)
    if not ok_rl:
        raise HTTPException(
            status_code=429,
            detail=f"发送验证码过于频繁，请 {wait} 秒后再试",
            headers={"Retry-After": str(wait)},
        )
    ok, err, meta = auth_bridge.register_send_otp(
        body.email.strip().lower(),
        body.username.strip(),
        body.invite_code.strip(),
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err or "发送失败")
    msg = "验证码已发送"
    if meta.get("dev_otp_logged"):
        msg = "验证码已生成（日志模式，未发真实邮件）"
    return {
        "success": True,
        "verification_email_sent": bool(meta.get("verification_email_sent")),
        "dev_otp_logged": bool(meta.get("dev_otp_logged")),
        "message": msg,
        "smtp_dispatch": meta.get("smtp_dispatch"),
    }


@router.post("/register/verify-code")
def auth_register_verify_code_api(body: AuthRegisterVerifyCodeRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    ticket, err = auth_bridge.register_verify_otp(body.email.strip().lower(), body.code)
    if err or not ticket:
        raise HTTPException(status_code=400, detail=err or "验证失败")
    return {"success": True, "registration_ticket": ticket}


@router.post("/register/complete")
def auth_register_complete_api(body: AuthRegisterCompleteRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    token, err, _meta = auth_bridge.register_complete_with_ticket(body.registration_ticket.strip(), body.password)
    if err or not token:
        raise HTTPException(status_code=400, detail=err or "注册失败")
    user = auth_bridge.user_info_for_session_token(token) or auth_bridge.user_info_from_session_token(token)
    uid = str(user.get("user_id") or "").strip()
    sub_phone = str(user.get("phone") or "").strip() or None
    models.record_usage_event(
        job_id=None,
        phone=sub_phone,
        job_type="auth_register",
        metric="auth_register",
        status="succeeded",
        quantity=1,
        meta={"auth_method": "email_otp"},
        user_id=uid or None,
    )
    return {"success": True, "token": token, "user": user}


@router.post("/register")
def auth_register_api(body: AuthRegisterRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    token, err, meta = auth_bridge.register_user(
        body.password,
        body.invite_code.strip(),
        phone=(body.phone or "").strip() or None,
        email=(body.email or "").strip().lower() or None,
        username=(body.username or "").strip() or None,
    )
    if meta.get("needs_email_verification"):
        return {
            "success": True,
            "needs_email_verification": True,
            "verification_email_sent": bool(meta.get("verification_email_sent")),
            "message": "注册完成",
        }
    if err or not token:
        raise HTTPException(status_code=400, detail=err or "注册失败")
    user = auth_bridge.user_info_for_session_token(token) or auth_bridge.user_info_from_session_token(token)
    uid = str(user.get("user_id") or "").strip()
    sub_phone = str(user.get("phone") or "").strip() or None
    models.record_usage_event(
        job_id=None,
        phone=sub_phone,
        job_type="auth_register",
        metric="auth_register",
        status="succeeded",
        quantity=1,
        meta={"auth_method": "legacy_register"},
        user_id=uid or None,
    )
    return {"success": True, "token": token, "user": user}


@router.post("/login")
def auth_login_api(body: AuthLoginRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    lid = body.identifier.strip()
    token, err = auth_bridge.login_user(lid, body.password)
    if err or not token:
        raise HTTPException(status_code=400, detail=err or "登录失败")
    user = auth_bridge.user_info_for_session_token(token) or auth_bridge.user_info_from_session_token(token)
    uid = str(user.get("user_id") or "").strip()
    sub_phone = str(user.get("phone") or "").strip() or None
    models.record_usage_event(
        job_id=None,
        phone=sub_phone,
        job_type="auth_login",
        metric="auth_login",
        status="succeeded",
        quantity=1,
        meta={"auth_method": "password"},
        user_id=uid or None,
    )
    return {"success": True, "token": token, "user": user}


@router.post("/verify-email")
def auth_verify_email_api(body: AuthVerifyEmailRequest):
    ok, msg = verify_email_token(body.token.strip())
    if not ok:
        raise HTTPException(status_code=400, detail=msg or "验证失败")
    return {"success": True, "user_id": msg}


@router.post("/forgot-password")
def auth_forgot_password_api(body: AuthForgotPasswordRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    request_password_reset_by_email(body.email.strip().lower())
    return {
        "success": True,
        "message": "若该邮箱已注册且已完成验证，您将在几分钟内收到重置密码邮件。",
    }


@router.post("/reset-password")
def auth_reset_password_api(body: AuthResetPasswordRequest):
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="认证未启用")
    ok, msg = reset_password_with_token(body.token.strip(), body.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg or "重置失败")
    return {"success": True}


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
    principal = auth_bridge.session_principal(sess)
    if not principal:
        raise HTTPException(status_code=401, detail="未登录")
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="没有可更新字段")
    did = False
    if "display_name" in patch:
        dn = str(patch.get("display_name") or "").strip()
        if dn:
            ok, err = auth_bridge.update_display_name(principal, dn)
            if not ok:
                raise HTTPException(status_code=400, detail=err or "更新失败")
            did = True
    if "username" in patch:
        un = str(patch.get("username") or "").strip()
        if un:
            ok, err = auth_bridge.update_username(principal, un)
            if not ok:
                raise HTTPException(status_code=400, detail=err or "更新失败")
            did = True
    if not did:
        raise HTTPException(status_code=400, detail="没有可更新字段")
    return {"success": True, "user": auth_bridge.user_info_for_phone(principal)}


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
    principal = auth_bridge.session_principal(sess)
    if not principal:
        raise HTTPException(status_code=401, detail="未登录")
    return {"success": True, "user": auth_bridge.user_info_for_phone(principal)}


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
    ok, err = auth_bridge.unlock_feature(token, body.password, login_id=(body.phone or "").strip())
    if not ok:
        raise HTTPException(status_code=400, detail=err or "验证失败")
    return {"success": True}
