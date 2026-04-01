import logging
import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas import (
    SubscriptionSelectRequest,
    WalletTopupCheckoutCompleteRequest,
    WalletTopupCheckoutCreateRequest,
    WechatNativeSubscriptionCreateRequest,
    WechatNativeWalletCreateRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..entitlement_matrix import jobs_terminal_monthly_quota
from ..plan_catalog import (
    amount_cents_for_subscription,
    build_subscription_plans_response,
    is_valid_wallet_topup_amount_cents,
)
from ..wechat_pay_native import WechatPayNativeConfig, create_native_order, new_out_trade_no

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/subscription", tags=["subscription"], dependencies=[Depends(verify_internal_signature)])


def _simulated_wallet_checkout_enabled() -> bool:
    v = (
        os.getenv("SIMULATED_WALLET_CHECKOUT_ENABLED")
        or os.getenv("SIMULATED_PAYG_CHECKOUT_ENABLED")
        or "1"
    ).strip().lower()
    return v not in ("0", "false", "off", "no")


def _plan_monthly_quota(tier: str) -> int:
    return jobs_terminal_monthly_quota(tier)


@router.get("/plans")
def subscription_plans_api():
    return build_subscription_plans_response()


@router.get("/me")
def subscription_me_api(request: Request):
    if not auth_bridge.is_auth_enabled():
        return {
            "success": True,
            "plan": "free",
            "billing_cycle": None,
            "usage": None,
            "orders": [],
            "wallet_balance_cents": 0,
        }
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "")
    info = auth_bridge.user_info_for_phone(phone)
    tier = str(info.get("plan") or "free")
    quota = _plan_monthly_quota(tier)
    usage_raw = models.user_usage_for_phone(phone, 30)
    jt = int(usage_raw.get("jobs_terminal") or 0)
    pct = min(100, int(jt * 100 / quota)) if quota > 0 else 0
    orders = auth_bridge.list_payment_orders(phone, 40)
    bal = models.wallet_balance_cents_for_phone(phone)
    return {
        "success": True,
        **info,
        "usage": {
            "period_days": int(usage_raw.get("period_days") or 30),
            "jobs_terminal": jt,
            "quota": quota,
            "percent": pct,
        },
        "orders": orders,
        "wallet_balance_cents": bal,
        "subscription_checkout_intent": models.get_subscription_checkout_intent_for_api(phone),
    }


@router.post("/select")
def subscription_select_api(request: Request, body: SubscriptionSelectRequest):
    if not auth_bridge.is_auth_enabled():
        return {"success": True, "message": "本地模式未启用订阅鉴权"}
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "")
    tid = body.tier.strip().lower()
    cycle = str(body.billing_cycle or "").strip().lower() if body.billing_cycle else None
    if tid == "free":
        models.merge_user_preferences_for_phone(phone, {"subscription_checkout_intent_v1": {}})
        ok, err = auth_bridge.set_user_subscription(
            phone,
            "free",
            None,
            source="subscription_select_api",
            actor_phone=phone,
            meta={"route": "/api/v1/subscription/select"},
        )
        if not ok:
            raise HTTPException(status_code=400, detail=err or "无效请求")
        return {
            "success": True,
            "message": "已切换为 Free",
            "user": auth_bridge.user_info_for_phone(phone),
            "subscription_checkout_intent": models.get_subscription_checkout_intent_for_api(phone),
        }
    if tid not in ("basic", "pro", "max"):
        raise HTTPException(status_code=400, detail="invalid_tier")
    if cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="billing_cycle_required_for_paid_tier")
    ok_m, err_m = models.merge_user_preferences_for_phone(
        phone,
        {"subscription_checkout_intent_v1": {"tier": tid, "billing_cycle": cycle}},
    )
    if not ok_m:
        raise HTTPException(status_code=400, detail=err_m or "intent_save_failed")
    return {
        "success": True,
        "message": "已保存订阅意向，须完成支付后才会生效；请使用微信扫码支付或内测收银。",
        "user": auth_bridge.user_info_for_phone(phone),
        "subscription_checkout_intent": models.get_subscription_checkout_intent_for_api(phone),
    }


@router.post("/wallet-checkout/create")
def subscription_wallet_checkout_create(request: Request, body: WalletTopupCheckoutCreateRequest):
    """登录用户：创建钱包充值模拟收银会话（SIMULATED_WALLET_CHECKOUT_ENABLED，兼容 SIMULATED_PAYG_CHECKOUT_ENABLED）。"""
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    if not _simulated_wallet_checkout_enabled():
        raise HTTPException(status_code=403, detail="simulated_wallet_checkout_disabled")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    amt = int(body.amount_cents)
    if not is_valid_wallet_topup_amount_cents(amt):
        raise HTTPException(status_code=400, detail="invalid_topup_amount")
    checkout_id = f"subwal_{secrets.token_hex(16)}"
    if not models.wallet_create_checkout_session(phone, checkout_id, amt):
        raise HTTPException(status_code=500, detail="wallet_session_create_failed")
    return {
        "success": True,
        "checkout_id": checkout_id,
        "phone": phone,
        "amount_cents": amt,
        "currency": "CNY",
        "provider": "simulated",
        "message": "确认支付后入账钱包余额（不改变订阅档位）",
    }


@router.post("/wallet-checkout/complete")
def subscription_wallet_checkout_complete(request: Request, body: WalletTopupCheckoutCompleteRequest):
    """登录用户：确认模拟支付并入账钱包余额。"""
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    if not _simulated_wallet_checkout_enabled():
        raise HTTPException(status_code=403, detail="simulated_wallet_checkout_disabled")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    cid = body.checkout_id.strip()
    if not cid.startswith("subwal_"):
        raise HTTPException(status_code=400, detail="invalid_checkout_id")
    expected = models.wallet_get_checkout_session_amount_cents(phone, cid)
    if expected is None or not is_valid_wallet_topup_amount_cents(expected):
        raise HTTPException(status_code=400, detail="invalid_or_expired_checkout")
    ok, reason, row = auth_bridge.apply_payment_event(
        cid,
        phone,
        "free",
        None,
        "paid",
        expected,
        "subscription_simulated",
        channel="subscription_simulated",
        provider_order_id=f"sim_wal_{secrets.token_hex(10)}",
        currency="CNY",
        paid_at=datetime.now(timezone.utc),
        product_snapshot={
            "kind": "wallet_topup",
            "topup_cents": expected,
            "source": "subscription_wallet_checkout",
            "amount_cents": expected,
        },
        source="subscription_wallet_checkout",
    )
    if not ok:
        raise HTTPException(status_code=400, detail=reason or "wallet_checkout_complete_failed")
    models.wallet_delete_checkout_session(phone, cid)
    return {
        "success": True,
        "reason": reason,
        "order": row,
        "user": auth_bridge.user_info_for_phone(phone),
        "wallet_balance_cents": models.wallet_balance_cents_for_phone(phone),
    }


@router.post("/wechat/native/subscription")
def wechat_native_subscription_create(request: Request, body: WechatNativeSubscriptionCreateRequest):
    """登录用户：微信 Native 订阅下单，返回 code_url 供前端生成二维码。"""
    cfg = WechatPayNativeConfig.from_env()
    if not cfg:
        raise HTTPException(status_code=403, detail="wechat_native_disabled")
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    tid = body.tier.strip().lower()
    bc = body.billing_cycle.strip().lower()
    if tid not in ("basic", "pro", "max") or bc not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="invalid_tier_or_cycle")
    amount = amount_cents_for_subscription(tid, bc)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="invalid_plan_amount")
    out_trade_no = new_out_trade_no()
    if not models.wechat_native_create_checkout_session(phone, out_trade_no, "subscription", amount, tid, bc):
        raise HTTPException(status_code=500, detail="wechat_session_persist_failed")
    desc = f"订阅套餐 {tid} {bc}"
    ok, err, payload = create_native_order(
        cfg,
        out_trade_no=out_trade_no,
        description=desc,
        amount_total_cents=amount,
    )
    if not ok:
        models.wechat_native_delete_checkout_session(out_trade_no)
        _log.warning("wechat native subscription unifiedorder failed: %s", err)
        raise HTTPException(status_code=502, detail="wechat_unifiedorder_failed")
    return {
        "success": True,
        "provider": "wechat_native",
        "code_url": payload.get("code_url"),
        "out_trade_no": out_trade_no,
        "amount_cents": amount,
        "currency": "CNY",
        "tier": tid,
        "billing_cycle": bc,
        "message": "请使用微信扫一扫完成支付",
    }


@router.post("/wechat/native/wallet")
def wechat_native_wallet_create(request: Request, body: WechatNativeWalletCreateRequest):
    """登录用户：微信 Native 钱包充值下单。"""
    cfg = WechatPayNativeConfig.from_env()
    if not cfg:
        raise HTTPException(status_code=403, detail="wechat_native_disabled")
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    amt = int(body.amount_cents)
    if not is_valid_wallet_topup_amount_cents(amt):
        raise HTTPException(status_code=400, detail="invalid_topup_amount")
    out_trade_no = new_out_trade_no()
    if not models.wechat_native_create_checkout_session(phone, out_trade_no, "wallet", amt, None, None):
        raise HTTPException(status_code=500, detail="wechat_session_persist_failed")
    ok, err, payload = create_native_order(
        cfg,
        out_trade_no=out_trade_no,
        description="账户余额充值",
        amount_total_cents=amt,
    )
    if not ok:
        models.wechat_native_delete_checkout_session(out_trade_no)
        _log.warning("wechat native wallet unifiedorder failed: %s", err)
        raise HTTPException(status_code=502, detail="wechat_unifiedorder_failed")
    return {
        "success": True,
        "provider": "wechat_native",
        "code_url": payload.get("code_url"),
        "out_trade_no": out_trade_no,
        "amount_cents": amt,
        "currency": "CNY",
        "message": "请使用微信扫一扫完成支付",
    }
