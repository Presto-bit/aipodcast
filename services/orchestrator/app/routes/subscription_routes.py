import logging
import os
import secrets
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import date, datetime, time as dt_time, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas import (
    AlipayPageWalletCreateRequest,
    AlipayWalletReconcileRequest,
    WalletTopupCheckoutCompleteRequest,
    WalletTopupCheckoutCreateRequest,
)
from ..security import verify_internal_signature
from .. import auth_bridge
from .. import models
from ..plan_catalog import build_subscription_plans_response, is_valid_wallet_topup_amount_cents
from ..subscription_manifest import EXPERIENCE_NEW_USER_TEXT_CHARS, EXPERIENCE_NEW_USER_VOICE_MINUTES
from ..alipay_page_pay import (
    AlipayPagePayConfig,
    alipay_total_amount_yuan_to_cents,
    build_page_pay_url,
    new_out_trade_no,
    parse_alipay_notify_time,
    query_alipay_trade_for_page_pay,
)
from ..fyv_shared.payment_wallet_rate_limit import (
    check_wallet_alipay_create_rate_limit_for_phone,
    check_wallet_alipay_reconcile_rate_limit_for_phone,
)

_log = logging.getLogger(__name__)

# apply_payment_event 在 DB 层失败时可能返回 payment_event_tx_failed（旧）、transaction_exception（其它 DB 异常）、
# transaction_deadlock（40P01）；前两者与死锁均可能为瞬时错误，对账路径上做退避重试。
# apply_payment_event_timeout：独立线程超时返回；后台事务可能仍成功（幂等），前端可继续轮询 /me。
_WALLET_RECONCILE_APPLY_RETRY_REASONS = frozenset(
    {
        "payment_event_tx_failed",
        "transaction_exception",
        "transaction_deadlock",
        "apply_payment_event_timeout",
    }
)


def _wallet_reconcile_apply_payment_timed(
    *,
    out_trade_no: str,
    phone: str,
    notify_cents: int,
    trade_no: str | None,
    paid_at: datetime | None,
    timeout_s: float,
) -> tuple[bool, str, dict[str, Any] | None]:
    """
    在独立线程执行 apply_payment_event；主线程仅等待 timeout_s。
    避免 PG 长时间持锁/网络抖动时整段请求超过反代 read_timeout（常见 30s）→ 504 无 JSON。
    """
    snap: dict[str, Any] = {
        "kind": "wallet_topup",
        "topup_cents": notify_cents,
        "source": "alipay_page_wallet",
        "amount_cents": notify_cents,
    }

    def _run() -> tuple[bool, str, dict[str, Any] | None]:
        return auth_bridge.apply_payment_event(
            out_trade_no,
            phone,
            "free",
            None,
            "paid",
            notify_cents,
            "alipay",
            channel="alipay",
            provider_order_id=trade_no or None,
            currency="CNY",
            paid_at=paid_at,
            product_snapshot=snap,
            source="alipay_trade_query_reconcile",
        )

    if timeout_s <= 0:
        return False, "apply_timeout_budget_exhausted", None
    pool: ThreadPoolExecutor | None = None
    try:
        pool = ThreadPoolExecutor(max_workers=1)
        fut = pool.submit(_run)
        return fut.result(timeout=float(timeout_s))
    except FuturesTimeoutError:
        _log.warning(
            "alipay wallet reconcile apply timed out out_trade_no=%s timeout_s=%s",
            out_trade_no,
            timeout_s,
        )
        return False, "apply_payment_event_timeout", None
    finally:
        if pool is not None:
            pool.shutdown(wait=False)


router = APIRouter(prefix="/api/v1/subscription", tags=["subscription"], dependencies=[Depends(verify_internal_signature)])


def _consumption_range_from_request(request: Request) -> tuple[datetime | None, datetime | None, bool]:
    """
    解析消费记录筛选：consumption_since / consumption_until（YYYY-MM-DD）。
    无参数时返回 (None, None, False)，列表仍返回最近记录但不计算汇总金额。
    有任一参数时第三项为 True，汇总该闭区间内成功任务的钱包消费分。
    """
    since_q = (request.query_params.get("consumption_since") or "").strip()
    until_q = (request.query_params.get("consumption_until") or "").strip()
    if not since_q and not until_q:
        return None, None, False

    def _parse_day(s: str) -> date:
        return date.fromisoformat(s[:10])

    try:
        if since_q:
            d0 = _parse_day(since_q)
            since_dt = datetime.combine(d0, dt_time.min, tzinfo=timezone.utc)
        else:
            since_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
        if until_q:
            d1 = _parse_day(until_q)
            until_dt = datetime(d1.year, d1.month, d1.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        else:
            until_dt = datetime.now(timezone.utc)
        if since_q and until_q and _parse_day(until_q) < _parse_day(since_q):
            raise ValueError("until_before_since")
        return since_dt, until_dt, True
    except Exception:
        return None, None, False


def _simulated_wallet_checkout_enabled() -> bool:
    v = (
        os.getenv("SIMULATED_WALLET_CHECKOUT_ENABLED")
        or os.getenv("SIMULATED_PAYG_CHECKOUT_ENABLED")
        or "1"
    ).strip().lower()
    return v not in ("0", "false", "off", "no")


@router.get("/plans")
def subscription_plans_api():
    """兼容路径：仅返回钱包充值与用量参考（会员档位已下线）。"""
    return build_subscription_plans_response()


@router.get("/me")
def subscription_me_api(request: Request):
    if not auth_bridge.is_auth_enabled():
        return {
            "success": True,
            "wallet_balance_cents": 0,
            "experience": {
                "voice_minutes_remaining": 0.0,
                "text_chars_remaining": 0,
                "voice_minutes_total": None,
                "text_chars_total": None,
            },
            "recharge_records": [],
            "consumption_records": [],
        }
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    info = dict(auth_bridge.user_info_for_phone(phone))
    for k in ("plan", "acct_tier", "billing_cycle"):
        info.pop(k, None)
    bal = models.wallet_balance_cents_for_phone(phone)
    recharge = models.list_wallet_recharge_rows_for_phone(phone, 80)
    since_f, until_f, consumption_sum_enabled = _consumption_range_from_request(request)
    lim_cons = 200 if consumption_sum_enabled else 80
    consumption = models.list_wallet_consumption_rows_for_phone(
        phone, lim_cons, since=since_f, until=until_f
    )
    consumption_filtered_wallet_total_cents: int | None = None
    if consumption_sum_enabled and since_f is not None and until_f is not None:
        consumption_filtered_wallet_total_cents = models.sum_wallet_consumption_wallet_cents_succeeded_for_phone(
            phone, since=since_f, until=until_f
        )
    has_experience_pack = models.experience_pack_row_exists_for_phone(phone)
    experience_body = {
        "voice_minutes_remaining": round(float(models.experience_voice_minutes_for_phone(phone) or 0), 4),
        "text_chars_remaining": int(models.experience_text_chars_for_phone(phone) or 0),
    }
    if has_experience_pack:
        experience_body["voice_minutes_total"] = float(EXPERIENCE_NEW_USER_VOICE_MINUTES)
        experience_body["text_chars_total"] = int(EXPERIENCE_NEW_USER_TEXT_CHARS)
    else:
        experience_body["voice_minutes_total"] = None
        experience_body["text_chars_total"] = None
    return {
        "success": True,
        **info,
        "wallet_balance_cents": bal,
        "experience": experience_body,
        "recharge_records": recharge,
        "consumption_records": consumption,
        "consumption_filtered_wallet_total_cents": consumption_filtered_wallet_total_cents,
    }


@router.post("/wallet-checkout/create")
def subscription_wallet_checkout_create(request: Request, body: WalletTopupCheckoutCreateRequest):
    """登录用户：创建钱包充值模拟收银会话。"""
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
        "message": "确认支付后入账钱包余额",
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
    ok_rl, wait_s = check_wallet_alipay_create_rate_limit_for_phone(phone)
    if not ok_rl:
        raise HTTPException(
            status_code=429,
            detail="wallet_alipay_create_rate_limited",
            headers={"Retry-After": str(wait_s)},
        )
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


@router.post("/alipay/wallet/reconcile")
def alipay_wallet_reconcile_trade_query(request: Request, body: AlipayWalletReconcileRequest):
    """
    用户从支付宝返回后：若异步通知未到，可用商户订单号调 alipay.trade.query 主动履约入账。
    须与当前登录用户 checkout 会话一致；幂等与异步通知共用 event_id=out_trade_no。
    """
    # 常见反代 proxy_read_timeout≈30s：trade.query 与 apply 均须带硬上限；且 ThreadPoolExecutor 超时后须 shutdown(wait=False)，
    # 否则 __exit__ 会等子线程结束，仍会导致整请求 >30s → 504。
    _reconcile_deadline = time.monotonic() + 25.0
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
    ok_rl, wait_s = check_wallet_alipay_reconcile_rate_limit_for_phone(phone)
    if not ok_rl:
        raise HTTPException(
            status_code=429,
            detail="wallet_alipay_reconcile_rate_limited",
            headers={"Retry-After": str(wait_s)},
        )

    out_trade_no = body.out_trade_no.strip()
    row_sess = models.alipay_page_get_checkout_session(out_trade_no)
    if not row_sess:
        ex = models.get_payment_order_by_event_id(out_trade_no)
        st_ex = str((ex or {}).get("status") or "").strip().lower()
        if ex and st_ex in ("paid", "success", "succeeded", "captured"):
            bal = models.wallet_balance_cents_for_phone(phone)
            return {"success": True, "applied": False, "detail": "already_settled", "wallet_balance_cents": bal}
        raise HTTPException(status_code=404, detail="checkout_session_not_found")

    if models.normalize_payment_principal(str(row_sess.get("phone") or "")) != models.normalize_payment_principal(
        phone
    ):
        raise HTTPException(status_code=403, detail="out_trade_no_mismatch")
    if str(row_sess.get("kind") or "").strip().lower() != "wallet":
        raise HTTPException(status_code=400, detail="not_wallet_checkout")

    _rem = _reconcile_deadline - time.monotonic()
    if _rem < 2.5:
        raise HTTPException(status_code=503, detail="reconcile_deadline_exceeded")
    # 为 apply 阶段预留时间；trade.query 过长会挤占 DB 入账窗口并触发反代 504。
    _q_timeout = max(2.0, min(7.0, _rem - 1.0))
    outcome, qresp = query_alipay_trade_for_page_pay(
        cfg, out_trade_no=out_trade_no, timeout_s=_q_timeout
    )
    if outcome == "rpc_error":
        raise HTTPException(status_code=502, detail="alipay_trade_query_failed")
    if outcome == "not_found":
        return {
            "success": True,
            "applied": False,
            "detail": "trade_not_found",
            "wallet_balance_cents": models.wallet_balance_cents_for_phone(phone),
        }
    if outcome != "paid":
        return {
            "success": True,
            "applied": False,
            "detail": "trade_not_paid_yet",
            "trade_status": qresp.get("trade_status"),
            "wallet_balance_cents": models.wallet_balance_cents_for_phone(phone),
        }

    notify_cents = alipay_total_amount_yuan_to_cents(str(qresp.get("total_amount") or ""))
    if notify_cents is None or notify_cents <= 0:
        _log.error(
            "alipay wallet reconcile invalid total_amount out_trade_no=%s raw=%s",
            out_trade_no,
            qresp.get("total_amount"),
        )
        raise HTTPException(status_code=502, detail="alipay_query_amount_invalid")
    session_cents = int(row_sess.get("amount_cents") or 0)
    if session_cents != notify_cents:
        _log.error(
            "alipay wallet reconcile amount_mismatch out_trade_no=%s session=%s query=%s",
            out_trade_no,
            session_cents,
            notify_cents,
        )
        raise HTTPException(status_code=409, detail="amount_mismatch")

    trade_no = str(qresp.get("trade_no") or "").strip()
    paid_at = parse_alipay_notify_time(qresp.get("send_pay_date") or qresp.get("gmt_payment"))
    ok_apply = False
    last_reason = ""
    for attempt in range(4):
        if time.monotonic() >= _reconcile_deadline - 0.2:
            _log.warning(
                "alipay wallet reconcile deadline before apply out_trade_no=%s attempt=%s",
                out_trade_no,
                attempt,
            )
            bal = models.wallet_balance_cents_for_phone(phone)
            return {
                "success": True,
                "applied": False,
                "detail": "reconcile_apply_pending",
                "wallet_balance_cents": bal,
            }
        _apply_budget = _reconcile_deadline - time.monotonic() - 0.25
        _apply_timeout = min(7.0, max(1.5, _apply_budget))
        ok, reason, _row = _wallet_reconcile_apply_payment_timed(
            out_trade_no=out_trade_no,
            phone=phone,
            notify_cents=notify_cents,
            trade_no=trade_no or None,
            paid_at=paid_at,
            timeout_s=_apply_timeout,
        )
        last_reason = str(reason or "").strip()
        if ok:
            ok_apply = True
            break
        if last_reason == "payment_integrity_error":
            _log.error("alipay wallet reconcile integrity out_trade_no=%s", out_trade_no)
            raise HTTPException(status_code=409, detail=last_reason)
        if last_reason == "apply_timeout_budget_exhausted":
            bal = models.wallet_balance_cents_for_phone(phone)
            return {
                "success": True,
                "applied": False,
                "detail": "reconcile_apply_pending",
                "wallet_balance_cents": bal,
            }
        if last_reason not in _WALLET_RECONCILE_APPLY_RETRY_REASONS:
            _log.error("alipay wallet reconcile apply failed out_trade_no=%s reason=%s", out_trade_no, last_reason)
            raise HTTPException(status_code=500, detail=last_reason or "apply_failed")
        ex2 = models.get_payment_order_by_event_id(out_trade_no)
        st2 = str((ex2 or {}).get("status") or "").strip().lower()
        if ex2 and st2 in ("paid", "success", "succeeded", "captured"):
            ok_apply = True
            break
        if attempt < 3:
            sleep_s = min(0.35, 0.05 * (2**attempt))
            if time.monotonic() + sleep_s >= _reconcile_deadline - 0.15:
                bal = models.wallet_balance_cents_for_phone(phone)
                return {
                    "success": True,
                    "applied": False,
                    "detail": "reconcile_apply_pending",
                    "wallet_balance_cents": bal,
                }
            time.sleep(sleep_s)
    if not ok_apply:
        if last_reason in _WALLET_RECONCILE_APPLY_RETRY_REASONS:
            bal = models.wallet_balance_cents_for_phone(phone)
            _log.warning(
                "alipay wallet reconcile exhausted retries out_trade_no=%s reason=%s balance=%s",
                out_trade_no,
                last_reason,
                bal,
            )
            return {
                "success": True,
                "applied": False,
                "detail": "reconcile_apply_pending",
                "wallet_balance_cents": bal,
            }
        _log.error(
            "alipay wallet reconcile apply failed after retries out_trade_no=%s reason=%s",
            out_trade_no,
            last_reason,
        )
        raise HTTPException(status_code=500, detail=last_reason or "apply_failed")
    models.alipay_page_delete_checkout_session(out_trade_no)
    bal = models.wallet_balance_cents_for_phone(phone)
    _log.info("alipay wallet reconcile applied out_trade_no=%s cents=%s balance=%s", out_trade_no, notify_cents, bal)
    return {"success": True, "applied": True, "wallet_balance_cents": bal}
