import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from .. import auth_bridge
from .. import models
from ..alipay_page_pay import AlipayPagePayConfig, verify_notify_params
from ..fyv_shared.payment_wallet_rate_limit import check_alipay_notify_rate_limit
from ..fyv_shared.register_send_code_limiter import client_ip_from_request
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1", tags=["webhooks"])
_log = logging.getLogger(__name__)


def _pick_first_non_empty(body: dict, keys: list[str]) -> str:
    for k in keys:
        v = body.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _normalize_status(raw_status: str) -> str:
    s = (raw_status or "").strip().lower()
    mapping = {
        "success": "paid",
        "succeeded": "paid",
        "paid": "paid",
        "captured": "paid",
        "ok": "paid",
        "created": "created",
        "pending": "pending_payment",
        "pending_payment": "pending_payment",
        "authorized": "authorized",
        "fail": "failed",
        "failed": "failed",
        "error": "failed",
        "refund": "refunded",
        "refunded": "refunded",
        "partial_refund": "partially_refunded",
        "partially_refunded": "partially_refunded",
        "chargeback": "chargeback",
        "disputed": "disputed",
        "closed": "closed",
        "expired": "expired",
        "cancel": "cancelled",
        "cancelled": "cancelled",
    }
    return mapping.get(s, "unknown")


def _normalize_currency(raw_currency: str) -> str:
    code = (raw_currency or "").strip().upper() or "CNY"
    allowed = {"CNY", "USD", "EUR", "JPY", "HKD", "SGD"}
    return code if code in allowed else "CNY"


def _normalize_channel(raw_channel: str) -> str:
    s = (raw_channel or "").strip().lower() or "unknown"
    mapping = {
        "alipay": "alipay",
        "ali": "alipay",
        "stripe": "stripe",
        "applepay": "apple",
        "apple": "apple",
        "googlepay": "google",
        "google": "google",
    }
    normalized = mapping.get(s, s)
    allowed = {"alipay", "stripe", "apple", "google", "unknown"}
    return normalized if normalized in allowed else "unknown"


def _collect_nonempty_values(body: dict, keys: list[str]) -> list[str]:
    out: list[str] = []
    for k in keys:
        v = body.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out.append(s)
    return out


def _safe_int(v):
    try:
        if v is None or str(v).strip() == "":
            return None
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _redact_payload(obj):
    sensitive_keys = {"password", "token", "secret", "sign", "signature", "id_card", "bank", "card_no", "phone"}
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            kk = str(k).strip().lower()
            if any(sk in kk for sk in sensitive_keys):
                out[k] = "***"
            else:
                out[k] = _redact_payload(v)
        return out
    if isinstance(obj, list):
        return [_redact_payload(x) for x in obj]
    return obj


@router.post("/webhooks/payment")
async def payment_webhook(request: Request):
    """
    支付回调：请求体为 JSON。生产环境设置 PAYMENT_WEBHOOK_SECRET，
    并将 X-Payment-Signature 设为 HMAC-SHA256(密钥, 原始 body) 的十六进制字符串。
    本地可设 PAYMENT_WEBHOOK_ALLOW_UNSIGNED=1 跳过验签（仅开发）。
    """
    secret = (os.getenv("PAYMENT_WEBHOOK_SECRET") or "").strip()
    allow_unsigned = (os.getenv("PAYMENT_WEBHOOK_ALLOW_UNSIGNED") or "").strip().lower() in ("1", "true", "yes")
    strict_mapping = (os.getenv("PAYMENT_WEBHOOK_STRICT_MAPPING") or "").strip().lower() in ("1", "true", "yes")
    store_raw_payload = (os.getenv("PAYMENT_WEBHOOK_STORE_RAW") or "").strip().lower() in ("1", "true", "yes")
    raw = await request.body()
    payload_hash = hashlib.sha256(raw).hexdigest()
    request_id = str(request.headers.get("X-Request-ID") or request.headers.get("X-Correlation-ID") or "").strip() or None
    trace_id = str(request.headers.get("X-Trace-ID") or "").strip() or secrets.token_hex(8)
    sig_hdr = (request.headers.get("X-Payment-Signature") or "").strip()
    signature_ok = False
    if secret:
        expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        if sig_hdr != expected:
            redacted_empty = {"_note": "rejected_before_parse"}
            models.record_payment_webhook_delivery(
                event_id="unknown",
                provider="unknown",
                signature_ok=False,
                payload_hash=payload_hash,
                process_result="rejected_signature",
                payload={} if not store_raw_payload else {"_raw": raw.decode("utf-8", errors="ignore")[:2000]},
                payload_redacted=redacted_empty,
                error="invalid_signature",
                trace_id=trace_id,
                request_id=request_id,
            )
            raise HTTPException(status_code=401, detail="invalid_signature")
        signature_ok = True
    elif not allow_unsigned:
        models.record_payment_webhook_delivery(
            event_id="unknown",
            provider="unknown",
            signature_ok=False,
            payload_hash=payload_hash,
            process_result="rejected_no_secret",
            payload={},
            error="payment_webhook_secret_not_configured",
            trace_id=trace_id,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=503,
            detail="payment_webhook_secret_not_configured_set_PAYMENT_WEBHOOK_ALLOW_UNSIGNED_for_dev",
        )
    else:
        signature_ok = True
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_json") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_body")
    body_redacted = _redact_payload(body)
    event_id = _pick_first_non_empty(body, ["event_id", "id", "eventId"])
    phone = str(body.get("phone") or "").strip()
    tier = str(body.get("tier") or "free").strip()
    cycle_raw = body.get("billing_cycle")
    cycle_s = str(cycle_raw).strip().lower() if cycle_raw else None
    status = _normalize_status(_pick_first_non_empty(body, ["status", "trade_status", "order_status"]))
    try:
        amount_cents = int(body.get("amount_cents") or 0)
    except (TypeError, ValueError):
        amount_cents = 0
    provider = str(body.get("provider") or "unknown").strip()
    currency_candidates = _collect_nonempty_values(body, ["currency", "currency_code", "settle_currency"])
    channel_candidates = _collect_nonempty_values(body, ["channel", "source", "pay_channel"])
    provider_order_candidates = _collect_nonempty_values(body, ["provider_order_id", "order_no", "trade_no", "out_trade_no"])
    currency = _normalize_currency(currency_candidates[0] if currency_candidates else "CNY")
    provider_order_id = (provider_order_candidates[0] if provider_order_candidates else "") or None
    channel = _normalize_channel(channel_candidates[0] if channel_candidates else "unknown")

    # 发现多源字段值冲突时，保留“第一优先级字段”为准，并写入审计元信息。
    mapping_conflicts: dict[str, list[str]] = {}
    if len(set([x.upper() for x in currency_candidates])) > 1:
        mapping_conflicts["currency"] = currency_candidates
    if len(set([x.lower() for x in channel_candidates])) > 1:
        mapping_conflicts["channel"] = channel_candidates
    if len(set(provider_order_candidates)) > 1:
        mapping_conflicts["provider_order_id"] = provider_order_candidates

    def _parse_dt(v):
        s = str(v or "").strip()
        if not s:
            return None
        try:
            if s.isdigit():
                return datetime.fromtimestamp(int(s), tz=timezone.utc)
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    paid_at = _parse_dt(body.get("paid_at") or body.get("success_at") or body.get("pay_time"))
    failed_at = _parse_dt(body.get("failed_at"))
    refunded_at = _parse_dt(body.get("refunded_at") or body.get("refund_at"))
    webhook_meta = {
        "mapping": {
            "status": status,
            "currency_candidates": currency_candidates,
            "channel_candidates": channel_candidates,
            "provider_order_id_candidates": provider_order_candidates,
        }
    }
    if mapping_conflicts:
        webhook_meta["mapping_conflicts"] = mapping_conflicts
        if strict_mapping:
            models.record_payment_webhook_delivery(
                event_id=event_id or "unknown",
                provider=provider or "unknown",
                signature_ok=signature_ok,
                payload_hash=payload_hash,
                process_result="rejected_mapping_conflict",
                payload=({**body, "_webhook_meta": webhook_meta} if store_raw_payload else {}),
                payload_redacted={**body_redacted, "_webhook_meta": webhook_meta},
                error="mapping_conflict",
                trace_id=trace_id,
                request_id=request_id,
            )
            raise HTTPException(status_code=400, detail="mapping_conflict")

    def _parse_float(v):
        try:
            if v is None or str(v).strip() == "":
                return None
            return float(str(v).strip())
        except (TypeError, ValueError):
            return None

    settlement_amount_cents = _safe_int(body.get("settlement_amount_cents"))
    settlement_currency = _pick_first_non_empty(body, ["settlement_currency", "settle_currency"])
    fx_rate_snapshot = _parse_float(body.get("fx_rate_snapshot") or body.get("fx_rate"))
    refunded_amount_cents = _safe_int(body.get("refunded_amount_cents"))
    refund_id = _pick_first_non_empty(body, ["refund_id", "out_refund_no", "provider_refund_id"])
    refund_reason = _pick_first_non_empty(body, ["refund_reason", "reason"])
    idempotency_key = _pick_first_non_empty(body, ["idempotency_key", "idem_key"])
    client_request_id = _pick_first_non_empty(body, ["client_request_id", "merchant_request_id", "request_no"])
    product_snapshot = body.get("product_snapshot") if isinstance(body.get("product_snapshot"), dict) else {}
    order_items = body.get("order_items") if isinstance(body.get("order_items"), list) else []
    amount_subtotal_cents = _safe_int(body.get("amount_subtotal_cents"))
    discount_cents = _safe_int(body.get("discount_cents"))
    tax_cents = _safe_int(body.get("tax_cents"))
    payable_cents = _safe_int(body.get("payable_cents"))
    paid_cents = _safe_int(body.get("paid_cents"))
    fallback_ip = request.client.host if request.client else ""
    source_ip = str(request.headers.get("X-Forwarded-For") or fallback_ip).split(",")[0].strip() or None
    user_agent = str(request.headers.get("User-Agent") or "").strip() or None
    ok, reason, row = auth_bridge.apply_payment_event(
        event_id,
        phone,
        tier,
        cycle_s,
        status,
        amount_cents,
        provider,
        trace_id=trace_id,
        request_id=request_id,
        currency=currency,
        provider_order_id=provider_order_id,
        channel=channel,
        paid_at=paid_at,
        failed_at=failed_at,
        refunded_at=refunded_at,
        settlement_amount_cents=settlement_amount_cents,
        settlement_currency=settlement_currency,
        fx_rate_snapshot=fx_rate_snapshot,
        refunded_amount_cents=refunded_amount_cents,
        refund_id=(refund_id or None),
        refund_reason=(refund_reason or None),
        idempotency_key=(idempotency_key or None),
        client_request_id=(client_request_id or None),
        product_snapshot=product_snapshot,
        order_items=order_items,
        amount_subtotal_cents=amount_subtotal_cents,
        discount_cents=discount_cents,
        tax_cents=tax_cents,
        payable_cents=payable_cents,
        paid_cents=paid_cents,
        source_ip=source_ip,
        user_agent=user_agent,
    )
    models.record_payment_webhook_delivery(
        event_id=event_id or "unknown",
        provider=provider or "unknown",
        signature_ok=signature_ok,
        payload_hash=payload_hash,
        process_result="processed_ok" if ok else "processed_error",
        payload=({**body, "_webhook_meta": webhook_meta} if store_raw_payload else {}),
        payload_redacted={**body_redacted, "_webhook_meta": webhook_meta},
        error=None if ok else reason,
        trace_id=trace_id,
        request_id=request_id,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    return JSONResponse({"success": True, "reason": reason, "order": row})


def _parse_alipay_notify_time(raw: object) -> datetime | None:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        normalized = s.replace("Z", "+00:00") if s.endswith("Z") else s
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        pass
    try:
        from email.utils import parsedate_to_datetime

        dt2 = parsedate_to_datetime(s)
        if dt2.tzinfo is None:
            dt2 = dt2.replace(tzinfo=timezone.utc)
        return dt2
    except Exception:
        return None


def _alipay_total_amount_to_cents(total_amount: str) -> int | None:
    try:
        return int(round(float(str(total_amount or "").strip()) * 100))
    except (TypeError, ValueError):
        return None


def _handle_alipay_trade_notify(cfg: AlipayPagePayConfig, params: dict[str, str]) -> PlainTextResponse:
    trade_status = str(params.get("trade_status") or "").strip().upper()
    if trade_status not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        return PlainTextResponse("success")
    if str(params.get("app_id") or "").strip() != cfg.app_id:
        _log.error(
            "alipay_reconcile app_id_mismatch needs_manual_reconciliation=1 out_trade_no=%s",
            params.get("out_trade_no"),
        )
        return PlainTextResponse("success")
    out_trade_no = str(params.get("out_trade_no") or "").strip()
    trade_no = str(params.get("trade_no") or "").strip()
    notify_cents = _alipay_total_amount_to_cents(params.get("total_amount") or "")
    if not out_trade_no or notify_cents is None or notify_cents <= 0:
        return PlainTextResponse("success")
    paid_at = _parse_alipay_notify_time(params.get("gmt_payment") or params.get("notify_time"))
    row_sess = models.alipay_page_get_checkout_session(out_trade_no)
    if not row_sess:
        existing = models.get_payment_order_by_event_id(out_trade_no)
        if existing and str(existing.get("status") or "").strip().lower() in (
            "paid",
            "success",
            "succeeded",
            "captured",
        ):
            return PlainTextResponse("success")
        _log.error(
            "alipay_reconcile no_checkout_session needs_manual_reconciliation=1 out_trade_no=%s "
            "(无法入账；常见原因：支付完成前又发起新的同类型支付宝下单导致旧会话被替换，或会话已超过保留期)",
            out_trade_no,
        )
        return PlainTextResponse("success")
    session_cents = int(row_sess.get("amount_cents") or 0)
    if session_cents != notify_cents:
        _log.error(
            "alipay_reconcile amount_mismatch needs_manual_reconciliation=1 out_trade_no=%s session_cents=%s notify_cents=%s",
            out_trade_no,
            session_cents,
            notify_cents,
        )
        return PlainTextResponse("success")
    phone = str(row_sess.get("phone") or "").strip()
    kind = str(row_sess.get("kind") or "").strip().lower()
    if kind == "wallet":
        ok, reason, _row = auth_bridge.apply_payment_event(
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
            product_snapshot={
                "kind": "wallet_topup",
                "topup_cents": notify_cents,
                "source": "alipay_page_wallet",
                "amount_cents": notify_cents,
            },
            source="alipay_page_notify",
        )
    elif kind == "subscription":
        tier_s = str(row_sess.get("tier") or "free").strip().lower()
        bc_raw = row_sess.get("billing_cycle")
        bc_s = str(bc_raw).strip().lower() if bc_raw else None
        ok, reason, _row = auth_bridge.apply_payment_event(
            out_trade_no,
            phone,
            tier_s,
            bc_s,
            "paid",
            notify_cents,
            "alipay",
            channel="alipay",
            provider_order_id=trade_no or None,
            currency="CNY",
            paid_at=paid_at,
            product_snapshot={
                "source": "alipay_page",
                "tier": tier_s,
                "billing_cycle": bc_s,
                "amount_cents": notify_cents,
            },
            source="alipay_page_notify",
        )
    else:
        return PlainTextResponse("success")
    if not ok:
        _log.error("alipay notify apply failed out_trade_no=%s reason=%s", out_trade_no, reason)
        return PlainTextResponse("fail", status_code=500)
    models.alipay_page_delete_checkout_session(out_trade_no)
    if kind == "subscription" and phone:
        models.merge_user_preferences_for_phone(phone, {"subscription_checkout_intent_v1": {}})
    return PlainTextResponse("success")


@router.post("/webhooks/alipay", dependencies=[Depends(verify_internal_signature)])
async def alipay_page_payment_notify(request: Request):
    """
    支付宝电脑网站支付异步通知（application/x-www-form-urlencoded）。
    开放平台 notify_url 应填 Next 公网 HTTPS（由 BFF 转发至此），须与 ALIPAY_NOTIFY_URL 逐字一致，例如：
    https://www.prestoai.cn/api/webhooks/alipay
    （勿将编排器 8008 端口直接暴露公网。）
    须带 BFF 内部签名头；可选头 x-fym-client-ip 为原始客户端 IP，供限流与审计。
    """
    cfg = AlipayPagePayConfig.from_env()
    if not cfg:
        return PlainTextResponse("fail", status_code=503)
    hdr_dict = {str(k): str(v) for k, v in request.headers.items()}
    xfym_ip = (request.headers.get("x-fym-client-ip") or "").strip()
    peer = request.client.host if request.client else None
    client_ip = xfym_ip or client_ip_from_request(hdr_dict, peer)
    ok_nl, wait_nl = check_alipay_notify_rate_limit(client_ip)
    if not ok_nl:
        return PlainTextResponse("fail", status_code=429, headers={"Retry-After": str(wait_nl)})
    form = await request.form()
    params: dict[str, str] = {}
    for k, v in form.multi_items():
        params[str(k)] = str(v)
    signature = str(params.pop("sign", "") or "").strip()
    verify_copy = dict(params)
    if not verify_notify_params(cfg, verify_copy, signature):
        _log.error(
            "alipay_reconcile rsa_verify_failed needs_manual_reconciliation=0 out_trade_no=%s",
            params.get("out_trade_no"),
        )
        return PlainTextResponse("fail", status_code=400)
    return _handle_alipay_trade_notify(cfg, params)
