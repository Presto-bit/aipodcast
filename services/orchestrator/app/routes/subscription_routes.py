import logging
import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas import (
    AlipayPageSubscriptionCreateRequest,
    AlipayPageWalletCreateRequest,
    SubscriptionSelectRequest,
    SubscriptionWalletPayRequest,
    WalletTopupCheckoutCompleteRequest,
    WalletTopupCheckoutCreateRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..entitlement_matrix import monthly_minutes_product_target, tier_ai_polish_monthly_quota
from ..plan_catalog import (
    amount_cents_for_subscription,
    build_subscription_plans_response,
    is_valid_wallet_topup_amount_cents,
)
from ..alipay_page_pay import AlipayPagePayConfig, build_page_pay_url, new_out_trade_no

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/subscription", tags=["subscription"], dependencies=[Depends(verify_internal_signature)])


def _simulated_wallet_checkout_enabled() -> bool:
    v = (
        os.getenv("SIMULATED_WALLET_CHECKOUT_ENABLED")
        or os.getenv("SIMULATED_PAYG_CHECKOUT_ENABLED")
        or "1"
    ).strip().lower()
    return v not in ("0", "false", "off", "no")


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
    phone = auth_bridge.session_principal(sess)
    info = auth_bridge.user_info_for_phone(phone)
    tier = str(info.get("plan") or "free")
    usage_raw = models.user_usage_for_phone(phone, 30)
    period_days = int(usage_raw.get("period_days") or 30)
    media_usage = models.subscription_media_usage_for_phone(phone, period_days)
    polish_cap_raw = int(tier_ai_polish_monthly_quota(tier))
    orders = auth_bridge.list_payment_orders(phone, 40)
    bal = models.wallet_balance_cents_for_phone(phone)
    return {
        "success": True,
        **info,
        "usage": {
            "period_days": period_days,
            "monthly_audio_minutes_cap": int(monthly_minutes_product_target(tier)),
            "monthly_audio_minutes_used": round(float(media_usage.get("audio_minutes_used") or 0), 2),
            "monthly_text_polish_used": int(media_usage.get("text_polish_used") or 0),
            "monthly_text_polish_cap": None if polish_cap_raw < 0 else int(polish_cap_raw),
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
    phone = auth_bridge.session_principal(sess)
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
    if cycle != "monthly":
        raise HTTPException(status_code=400, detail="billing_cycle_must_be_monthly")
    ok_m, err_m = models.merge_user_preferences_for_phone(
        phone,
        {"subscription_checkout_intent_v1": {"tier": tid, "billing_cycle": cycle}},
    )
    if not ok_m:
        raise HTTPException(status_code=400, detail=err_m or "intent_save_failed")
    return {
        "success": True,
        "message": "已保存订阅意向，须完成支付后才会生效；请使用支付宝电脑网站支付或内测收银。",
        "user": auth_bridge.user_info_for_phone(phone),
        "subscription_checkout_intent": models.get_subscription_checkout_intent_for_api(phone),
    }


@router.post("/pay-with-wallet")
def subscription_pay_with_wallet_api(request: Request, body: SubscriptionWalletPayRequest):
    """登录用户：从账户余额扣款并立即生效月付订阅（与支付宝支付成功后的订单效果一致）。"""
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="本地体验模式不支持余额支付")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    tid = body.tier.strip().lower()
    cycle = (str(body.billing_cycle or "monthly").strip().lower() or "monthly")
    if tid not in ("basic", "pro", "max"):
        raise HTTPException(status_code=400, detail="invalid_tier")
    if cycle != "monthly":
        raise HTTPException(status_code=400, detail="billing_cycle_must_be_monthly")
    amt = amount_cents_for_subscription(tid, cycle)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="invalid_amount")

    ok_debit, _bal_after = models.wallet_try_debit_cents(phone, amt)
    if not ok_debit:
        raise HTTPException(
            status_code=400,
            detail="账户余额不足，请先充值或使用支付宝支付",
        )

    eid = f"wsub_{secrets.token_hex(12)}"
    ok_ev, err_ev, _row = auth_bridge.apply_payment_event(
        eid,
        phone,
        tid,
        cycle,
        "paid",
        amt,
        "wallet_balance",
        source="subscription_pay_with_wallet",
    )
    if not ok_ev:
        models.wallet_credit_cents(phone, amt)
        _log.warning("subscription_pay_with_wallet apply_event failed phone=%s err=%s", phone[:4], err_ev)
        raise HTTPException(status_code=400, detail="订阅入账失败，已退回余额")

    models.merge_user_preferences_for_phone(phone, {"subscription_checkout_intent_v1": {}})
    return {
        "success": True,
        "message": "已使用账户余额支付并开通订阅",
        "user": auth_bridge.user_info_for_phone(phone),
        "wallet_balance_cents": models.wallet_balance_cents_for_phone(phone),
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
    phone = auth_bridge.session_principal(sess).strip()
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
    phone = auth_bridge.session_principal(sess).strip()
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


@router.post("/alipay/page/subscription")
def alipay_page_subscription_create(request: Request, body: AlipayPageSubscriptionCreateRequest):
    """登录用户：支付宝电脑网站订阅下单，返回 pay_page_url（弹窗或新窗口打开）。"""
    cfg = AlipayPagePayConfig.from_env()
    if not cfg:
        raise HTTPException(status_code=403, detail="alipay_page_pay_disabled")
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess).strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    tid = body.tier.strip().lower()
    bc = body.billing_cycle.strip().lower()
    if tid not in ("basic", "pro", "max") or bc != "monthly":
        raise HTTPException(status_code=400, detail="invalid_tier_or_cycle")
    amount = amount_cents_for_subscription(tid, bc)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="invalid_plan_amount")
    out_trade_no = new_out_trade_no()
    if not models.alipay_page_create_checkout_session(phone, out_trade_no, "subscription", amount, tid, bc):
        raise HTTPException(status_code=500, detail="alipay_session_persist_failed")
    desc = f"订阅套餐 {tid} {bc}"
    amt_yuan = f"{amount / 100:.2f}"
    ok, err, pay_url = build_page_pay_url(
        cfg,
        out_trade_no=out_trade_no,
        subject=desc,
        total_amount_yuan_str=amt_yuan,
    )
    if not ok or not pay_url:
        models.alipay_page_delete_checkout_session(out_trade_no)
        _log.warning("alipay page subscription build failed: %s", err)
        raise HTTPException(status_code=502, detail="alipay_page_pay_failed")
    return {
        "success": True,
        "provider": "alipay_page",
        "pay_page_url": pay_url,
        "out_trade_no": out_trade_no,
        "amount_cents": amount,
        "currency": "CNY",
        "tier": tid,
        "billing_cycle": bc,
        "message": "正在跳转支付宝收银台，请使用手机支付宝扫码完成支付",
    }


@router.post("/alipay/page/wallet")
def alipay_page_wallet_create(request: Request, body: AlipayPageWalletCreateRequest):
    """登录用户：支付宝电脑网站钱包充值下单。"""
    cfg = AlipayPagePayConfig.from_env()
    if not cfg:
        raise HTTPException(status_code=403, detail="alipay_page_pay_disabled")
    if not auth_bridge.is_auth_enabled():
        raise HTTPException(status_code=400, detail="auth_disabled")
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess).strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_session")
    amt = int(body.amount_cents)
    if not is_valid_wallet_topup_amount_cents(amt):
        raise HTTPException(status_code=400, detail="invalid_topup_amount")
    out_trade_no = new_out_trade_no()
    if not models.alipay_page_create_checkout_session(phone, out_trade_no, "wallet", amt, None, None):
        raise HTTPException(status_code=500, detail="alipay_session_persist_failed")
    amt_yuan = f"{amt / 100:.2f}"
    ok, err, pay_url = build_page_pay_url(
        cfg,
        out_trade_no=out_trade_no,
        subject="账户余额充值",
        total_amount_yuan_str=amt_yuan,
    )
    if not ok or not pay_url:
        models.alipay_page_delete_checkout_session(out_trade_no)
        _log.warning("alipay page wallet build failed: %s", err)
        raise HTTPException(status_code=502, detail="alipay_page_pay_failed")
    return {
        "success": True,
        "provider": "alipay_page",
        "pay_page_url": pay_url,
        "out_trade_no": out_trade_no,
        "amount_cents": amt,
        "currency": "CNY",
        "message": "正在跳转支付宝收银台，请使用手机支付宝扫码完成支付",
    }
