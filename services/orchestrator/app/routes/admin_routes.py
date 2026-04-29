import os
import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..schemas import (
    AdminCreateUserRequest,
    AdminDeleteUserRequest,
    AdminPodcastTemplatePatch,
    AdminSetRoleRequest,
    AdminTtsPolishPromptsPut,
    AdminWalletCreditRequest,
    WalletTopupCheckoutCompleteRequest,
    WalletTopupCheckoutCreateRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..legacy_bridge import get_tts_polish_default_requirements
from ..plan_catalog import is_valid_wallet_topup_amount_cents

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(verify_internal_signature)])


def _require_admin_phone(request: Request) -> str:
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    actor_phone = auth_bridge.session_principal(sess)
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
        acct_tier=body.acct_tier.strip().lower(),
        billing_cycle=cycle,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err or "新增用户失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(body.phone.strip())}


@router.delete("/users")
def admin_delete_user_api(request: Request, body: AdminDeleteUserRequest):
    _require_admin_phone(request)
    target_phone = body.phone.strip()
    ok, err = auth_bridge.admin_delete_user(target_phone)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "删除用户失败")
    return {"success": True, "deleted_phone": target_phone}


@router.post("/users/invalidate")
def admin_invalidate_user_api(request: Request, body: AdminDeleteUserRequest):
    """将账号标记为失效（不可登录），不删除库内用户记录。"""
    _require_admin_phone(request)
    target = body.phone.strip()
    ok, err = auth_bridge.admin_invalidate_user(target)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "设置失效失败")
    return {"success": True, "phone": target}


@router.post("/users/reactivate")
def admin_reactivate_user_api(request: Request, body: AdminDeleteUserRequest):
    """将失效（disabled）账号恢复为可登录。"""
    _require_admin_phone(request)
    target = body.phone.strip()
    ok, err = auth_bridge.admin_reactivate_user(target)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "恢复失败")
    return {"success": True, "phone": target}


@router.post("/users/role")
def admin_set_user_role_api(request: Request, body: AdminSetRoleRequest):
    _require_admin_phone(request)
    target_phone = body.phone.strip()
    ok, err = auth_bridge.set_user_role(target_phone, body.role.strip().lower())
    if not ok:
        raise HTTPException(status_code=400, detail=err or "设置失败")
    return {"success": True, "user": auth_bridge.user_info_for_phone(target_phone)}


@router.post("/users/wallet")
def admin_credit_user_wallet_api(request: Request, body: AdminWalletCreditRequest):
    """为指定用户增加钱包余额（不入 payment_orders，仅调账）。"""
    _require_admin_phone(request)
    if not is_valid_wallet_topup_amount_cents(int(body.amount_cents)):
        raise HTTPException(status_code=400, detail="amount_cents_out_of_range")
    ok, err, bal = auth_bridge.admin_credit_wallet_cents(body.phone.strip(), int(body.amount_cents))
    if not ok:
        raise HTTPException(status_code=400, detail=err or "充值失败")
    return {
        "success": True,
        "phone": body.phone.strip(),
        "amount_cents": int(body.amount_cents),
        "wallet_balance_cents": int(bal),
    }


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


@router.get("/usage/users/{user_ref}")
def admin_usage_user_detail_api(
    request: Request,
    user_ref: str,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_usage_user_detail(user_ref=user_ref, days=d, date_from=df, date_to=dt)
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


@router.get("/usage/revenue-expense")
def admin_revenue_expense_api(
    request: Request,
    date_from: str = Query(..., description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
    detail_limit: int = Query(default=400, ge=50, le=1000, description="收支明细最大条数"),
):
    """按日汇总模型参考成本（支出）与钱包实际扣费（收入），含分人/分模型与明细。"""
    _require_admin_phone(request)
    try:
        df = _parse_ymd(date_from.strip())
        dt = _parse_ymd(date_to.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD") from None
    try:
        payload = models.admin_revenue_expense_board(date_from=df, date_to=dt, detail_limit=detail_limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return {"success": True, **payload}


@router.get("/usage/orders")
def admin_usage_orders_api(
    request: Request,
    days: int | None = Query(default=None, ge=1, le=365),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD，与 date_to 同时有效"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    _require_admin_phone(request)
    d, df, dt = _parse_usage_window(days, date_from, date_to)
    try:
        payload = models.admin_orders_analytics(days=d, date_from=df, date_to=dt)
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


@router.patch("/jobs/{job_id}/podcast-template")
@router.post("/jobs/{job_id}/podcast-template")
def admin_patch_job_podcast_template(job_id: str, request: Request, body: AdminPodcastTemplatePatch):
    """将成功播客成片标记为（或取消）全站创作页模板。"""
    _require_admin_phone(request)
    ok, code = models.set_job_podcast_template_flag(job_id, bool(body.enabled))
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=str(code or "job_not_found_or_ineligible"),
        )
    return {
        "success": True,
        "job_id": str(job_id).strip(),
        "is_podcast_template": bool(body.enabled),
    }
