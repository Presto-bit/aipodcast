import os
import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..schemas import (
    AdminCreateUserRequest,
    AdminDeleteUserRequest,
    AdminSetRoleRequest,
    AdminSetSubscriptionRequest,
    AdminSubscriptionCheckoutCompleteRequest,
    AdminSubscriptionCheckoutCreateRequest,
    AdminTtsPolishPromptsPut,
    WalletTopupCheckoutCompleteRequest,
    WalletTopupCheckoutCreateRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..legacy_bridge import get_tts_polish_default_requirements
from ..entitlement_matrix import get_entitlement_matrix_payload
from ..plan_catalog import amount_cents_for_subscription, is_valid_wallet_topup_amount_cents

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(verify_internal_signature)])


def _require_admin_phone(request: Request) -> str:
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    actor_phone = str(sess.get("phone") or "").strip()
    if not actor_phone or not auth_bridge.is_admin_phone(actor_phone):
        raise HTTPException(status_code=403, detail="无管理员权限")
    return actor_phone


def _admin_simulated_checkout_enabled() -> bool:
    v = (os.getenv("ADMIN_SIMULATED_CHECKOUT_ENABLED") or "1").strip().lower()
    return v not in ("0", "false", "off", "no")


@router.get("/users")
def admin_list_users_api(request: Request):
    _require_admin_phone(request)
    users = auth_bridge.list_users_admin_view()
    return {"success": True, "users": users, "count": len(users)}


@router.post("/users")
def admin_create_user_api(request: Request, body: AdminCreateUserRequest):
    _require_admin_phone(request)
    cycle = str(body.billing_cycle or "").strip().lower() if body.billing_cycle else None
    ok, err = auth_bridge.admin_create_user(
        phone=body.phone.strip(),
        password=body.password,
        role=body.role.strip().lower(),
        plan=body.plan.strip().lower(),
        billing_cycle=cycle,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err or "新增用户失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(body.phone.strip())}


@router.delete("/users")
def admin_delete_user_api(request: Request, body: AdminDeleteUserRequest):
    actor_phone = _require_admin_phone(request)
    target_phone = body.phone.strip()
    if target_phone == actor_phone:
        raise HTTPException(status_code=400, detail="不能删除当前管理员账号")
    ok, err = auth_bridge.admin_delete_user(target_phone)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "删除用户失败")
    return {"success": True, "deleted_phone": target_phone}


@router.post("/users/role")
def admin_set_user_role_api(request: Request, body: AdminSetRoleRequest):
    _require_admin_phone(request)
    target_phone = body.phone.strip()
    ok, err = auth_bridge.set_user_role(target_phone, body.role.strip().lower())
    if not ok:
        raise HTTPException(status_code=400, detail=err or "设置失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(target_phone)}


@router.post("/users/subscription")
def admin_set_user_subscription_api(request: Request, body: AdminSetSubscriptionRequest):
    actor_phone = _require_admin_phone(request)
    phone = body.phone.strip()
    cycle = str(body.billing_cycle or "").strip().lower() if body.billing_cycle else None
    ok, err = auth_bridge.set_user_subscription(
        phone,
        body.tier.strip().lower(),
        cycle,
        source="admin_set_user_subscription_api",
        actor_phone=actor_phone,
        meta={"route": "/api/v1/admin/users/subscription"},
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err or "设置套餐失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(phone)}


def _parse_ymd(value: str) -> date:
    s = (value or "").strip()
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        raise ValueError("invalid_date_format")
    return date.fromisoformat(s)


@router.get("/usage/summary")
def admin_usage_summary_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    df_raw = (date_from or "").strip()
    dt_raw = (date_to or "").strip()
    if bool(df_raw) ^ bool(dt_raw):
        raise HTTPException(status_code=400, detail="请同时提供 date_from 与 date_to")
    if df_raw and dt_raw:
        try:
            df = _parse_ymd(df_raw)
            dt = _parse_ymd(dt_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD") from None
        try:
            summary = models.admin_usage_summary(date_from=df, date_to=dt)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)[:200]) from e
        return {
            "success": True,
            "date_from": df.isoformat(),
            "date_to": dt.isoformat(),
            "rows": summary.get("rows") or [],
            "source": summary.get("source") or "usage_events",
        }
    d = 30 if days is None else days
    try:
        summary = models.admin_usage_summary(days=d)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {
        "success": True,
        "days": d,
        "rows": summary.get("rows") or [],
        "source": summary.get("source") or "usage_events",
    }


@router.get("/usage/dashboard")
def admin_usage_dashboard_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    df_raw = (date_from or "").strip()
    dt_raw = (date_to or "").strip()
    if bool(df_raw) ^ bool(dt_raw):
        raise HTTPException(status_code=400, detail="请同时提供 date_from 与 date_to")
    df = None
    dt = None
    if df_raw and dt_raw:
        try:
            df = _parse_ymd(df_raw)
            dt = _parse_ymd(dt_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD") from None
    d = None if (df and dt) else (30 if days is None else days)
    try:
        dashboard = models.admin_usage_dashboard(days=d, date_from=df, date_to=dt)
        sessions = auth_bridge.active_sessions_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    overview = dict(dashboard.get("overview") or {})
    overview["active_sessions"] = int(sessions.get("active_sessions") or 0)
    overview["session_users"] = int(sessions.get("active_users") or 0)
    return {
        "success": True,
        "window": dashboard.get("window") or {},
        "overview": overview,
        "by_job_type": dashboard.get("by_job_type") or [],
        "by_input_type": dashboard.get("by_input_type") or [],
        "by_day": dashboard.get("by_day") or [],
        "top_users": dashboard.get("top_users") or [],
        "source": dashboard.get("source") or "usage_events",
    }


def _parse_usage_window(
    days: int | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[int | None, date | None, date | None]:
    df_raw = (date_from or "").strip()
    dt_raw = (date_to or "").strip()
    if bool(df_raw) ^ bool(dt_raw):
        raise HTTPException(status_code=400, detail="请同时提供 date_from 与 date_to")
    if df_raw and dt_raw:
        try:
            return None, _parse_ymd(df_raw), _parse_ymd(dt_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD") from None
    return (30 if days is None else days), None, None


@router.get("/usage/users")
def admin_usage_users_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
    limit: int = Query(default=50, ge=1, le=200),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_usage_users(days=d, date_from=df, date_to=dt, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/usage/users/{phone}")
def admin_usage_user_detail_api(
    request: Request,
    phone: str,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_usage_user_detail(phone=phone, days=d, date_from=df, date_to=dt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/usage/works")
def admin_usage_works_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_works_analysis(days=d, date_from=df, date_to=dt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/usage/alerts")
def admin_usage_alerts_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_usage_alerts(days=d, date_from=df, date_to=dt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/subscription/events")
def admin_subscription_events_api(
    request: Request,
    phone: str | None = Query(default=None, description="按手机号筛选"),
    event_type: str | None = Query(default=None, description="按事件类型筛选（如 payment_paid / subscription_set）"),
    source: str | None = Query(default=None, description="按来源筛选"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    _require_admin_phone(request)
    try:
        payload = models.admin_subscription_events(
            phone=phone,
            event_type=event_type,
            source=source,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/data/consistency")
def admin_data_consistency_api(
    request: Request,
    phone: str | None = Query(default=None, description="可选手机号过滤"),
    limit: int = Query(default=200, ge=1, le=1000, description="扫描记录数"),
):
    _require_admin_phone(request)
    try:
        payload = models.admin_data_consistency_report(phone=phone, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/entitlement-matrix")
def admin_entitlement_matrix_api(request: Request):
    """管理员只读：订阅与权限矩阵（与 entitlement_matrix 单一数据源一致）。"""
    _require_admin_phone(request)
    payload = get_entitlement_matrix_payload()
    return {"success": True, **payload}


@router.post("/subscription-checkout/create")
def admin_subscription_checkout_create(request: Request, body: AdminSubscriptionCheckoutCreateRequest):
    """
    管理员内测收银：创建待支付会话（仅返回 checkout_id 与金额，无真实三方跳转）。
    完成支付请调用 POST /subscription-checkout/complete。
    """
    actor_phone = _require_admin_phone(request)
    if not _admin_simulated_checkout_enabled():
        raise HTTPException(status_code=403, detail="admin_simulated_checkout_disabled")
    tid = body.tier.strip().lower()
    bc = body.billing_cycle.strip().lower()
    if tid not in ("basic", "pro", "max"):
        raise HTTPException(status_code=400, detail="仅支持 basic、pro 或 max 订阅支付")
    if bc not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="billing_cycle 须为 monthly 或 yearly")
    amount = amount_cents_for_subscription(tid, bc)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="invalid_plan_amount")
    checkout_id = f"admchk_{secrets.token_hex(16)}"
    return {
        "success": True,
        "checkout_id": checkout_id,
        "phone": actor_phone,
        "tier": tid,
        "billing_cycle": bc,
        "amount_cents": amount,
        "currency": "CNY",
        "provider": "admin_simulated",
        "message": "内测收银：下一步在页面点击「确认支付」完成入账",
    }


@router.post("/subscription-checkout/complete")
def admin_subscription_checkout_complete(request: Request, body: AdminSubscriptionCheckoutCompleteRequest):
    """管理员内测：对当前登录管理员账号模拟支付成功，写入订单并同步套餐。"""
    actor_phone = _require_admin_phone(request)
    if not _admin_simulated_checkout_enabled():
        raise HTTPException(status_code=403, detail="admin_simulated_checkout_disabled")
    tid = body.tier.strip().lower()
    bc = body.billing_cycle.strip().lower()
    cid = body.checkout_id.strip()
    if not cid.startswith("admchk_"):
        raise HTTPException(status_code=400, detail="invalid_checkout_id")
    if tid not in ("basic", "pro", "max") or bc not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="invalid_tier_or_cycle")
    expected = amount_cents_for_subscription(tid, bc)
    if expected <= 0:
        raise HTTPException(status_code=400, detail="invalid_plan_amount")
    ok, reason, row = auth_bridge.apply_payment_event(
        cid,
        actor_phone,
        tid,
        bc,
        "paid",
        expected,
        "admin_simulated",
        channel="admin_simulated",
        provider_order_id=f"sim_{secrets.token_hex(10)}",
        currency="CNY",
        paid_at=datetime.now(timezone.utc),
        product_snapshot={
            "source": "admin_subscription_checkout",
            "tier": tid,
            "billing_cycle": bc,
            "amount_cents": expected,
        },
    )
    if not ok:
        raise HTTPException(status_code=400, detail=reason or "checkout_complete_failed")
    return {
        "success": True,
        "reason": reason,
        "order": row,
        "user": auth_bridge.user_info_for_phone(actor_phone),
    }


@router.post("/wallet-checkout/create")
def admin_wallet_checkout_create(request: Request, body: WalletTopupCheckoutCreateRequest):
    """管理员内测：创建钱包充值待支付会话（不改变订阅档位）。"""
    actor_phone = _require_admin_phone(request)
    if not _admin_simulated_checkout_enabled():
        raise HTTPException(status_code=403, detail="admin_simulated_checkout_disabled")
    amt = int(body.amount_cents)
    if not is_valid_wallet_topup_amount_cents(amt):
        raise HTTPException(status_code=400, detail="invalid_topup_amount")
    checkout_id = f"admchk_wal_{secrets.token_hex(16)}"
    if not models.wallet_create_checkout_session(actor_phone, checkout_id, amt):
        raise HTTPException(status_code=500, detail="wallet_session_create_failed")
    return {
        "success": True,
        "checkout_id": checkout_id,
        "phone": actor_phone,
        "amount_cents": amt,
        "currency": "CNY",
        "provider": "admin_simulated",
        "message": "内测收银：确认支付后入账钱包余额（不改变订阅档位）",
    }


@router.post("/wallet-checkout/complete")
def admin_wallet_checkout_complete(request: Request, body: WalletTopupCheckoutCompleteRequest):
    """管理员内测：模拟支付成功，写入订单并增加钱包余额（分）。"""
    actor_phone = _require_admin_phone(request)
    if not _admin_simulated_checkout_enabled():
        raise HTTPException(status_code=403, detail="admin_simulated_checkout_disabled")
    cid = body.checkout_id.strip()
    if not cid.startswith("admchk_wal_"):
        raise HTTPException(status_code=400, detail="invalid_checkout_id")
    expected = models.wallet_get_checkout_session_amount_cents(actor_phone, cid)
    if expected is None or not is_valid_wallet_topup_amount_cents(expected):
        raise HTTPException(status_code=400, detail="invalid_or_expired_checkout")
    ok, reason, row = auth_bridge.apply_payment_event(
        cid,
        actor_phone,
        "free",
        None,
        "paid",
        expected,
        "admin_simulated",
        channel="admin_simulated",
        provider_order_id=f"sim_wal_{secrets.token_hex(10)}",
        currency="CNY",
        paid_at=datetime.now(timezone.utc),
        product_snapshot={
            "kind": "wallet_topup",
            "topup_cents": expected,
            "source": "admin_wallet_checkout",
            "amount_cents": expected,
        },
        source="admin_wallet_checkout",
    )
    if not ok:
        raise HTTPException(status_code=400, detail=reason or "wallet_checkout_complete_failed")
    models.wallet_delete_checkout_session(actor_phone, cid)
    return {
        "success": True,
        "reason": reason,
        "order": row,
        "user": auth_bridge.user_info_for_phone(actor_phone),
        "wallet_balance_cents": models.wallet_balance_cents_for_phone(actor_phone),
    }


@router.get("/tts-polish-prompts")
def admin_get_tts_polish_prompts(request: Request):
    _require_admin_phone(request)
    defaults = get_tts_polish_default_requirements()
    try:
        models.ensure_app_settings_schema()
        stored_dual = models.app_setting_get(models.APP_SETTING_TTS_POLISH_DUAL) or ""
        stored_single = models.app_setting_get(models.APP_SETTING_TTS_POLISH_SINGLE) or ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:240]) from e
    ov = models.get_tts_polish_requirement_overrides()
    eff_d = ov.get("dual") or defaults["dual"]
    eff_s = ov.get("single") or defaults["single"]
    return {
        "success": True,
        "defaults": defaults,
        "stored_dual": stored_dual,
        "stored_single": stored_single,
        "effective_dual": eff_d,
        "effective_single": eff_s,
    }


@router.put("/tts-polish-prompts")
def admin_put_tts_polish_prompts(request: Request, body: AdminTtsPolishPromptsPut):
    _require_admin_phone(request)
    ok, err = models.save_tts_polish_prompts(body.dual_requirements, body.single_requirements)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "保存失败")
    return admin_get_tts_polish_prompts(request)


@router.post("/tts-polish-prompts/reset")
def admin_reset_tts_polish_prompts(request: Request):
    _require_admin_phone(request)
    try:
        models.reset_tts_polish_prompts()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:240]) from e
    return admin_get_tts_polish_prompts(request)
