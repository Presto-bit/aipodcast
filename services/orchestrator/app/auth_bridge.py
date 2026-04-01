from datetime import datetime, timezone
from typing import Any

from app.fyv_shared import auth_service


def is_auth_enabled() -> bool:
    return bool(auth_service.is_auth_enabled())


def get_session_by_bearer(auth_header: str) -> dict[str, Any] | None:
    auth = str(auth_header or "").strip()
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    sess = auth_service.get_session(token)
    if not sess:
        return None
    return dict(sess)


def user_info_for_phone(phone: str) -> dict[str, Any]:
    base = dict(auth_service.user_info_for_phone(phone))
    try:
        from .models import get_user_profile_from_pg

        pg_row = get_user_profile_from_pg(phone)
        if pg_row:
            for key in ("display_name", "role", "plan", "billing_cycle"):
                if key in pg_row and pg_row.get(key) is not None:
                    base[key] = pg_row.get(key)
    except Exception:
        pass
    return base


def update_display_name(phone: str, display_name: str) -> tuple[bool, str | None]:
    ok, err = auth_service.update_display_name(phone, display_name)
    if not ok:
        return False, err
    try:
        from .models import sync_user_profile_to_pg

        sync_user_profile_to_pg(phone, display_name=(display_name or "").strip() or phone)
    except Exception:
        pass
    return True, None


def auth_config_dict() -> dict[str, Any]:
    return dict(auth_service.auth_config_dict())


def register_user(phone: str, password: str, invite_code: str) -> tuple[str | None, str | None]:
    token, err = auth_service.register_user(phone, password, invite_code)
    if token and not err:
        try:
            info = auth_service.user_info_for_phone(phone)
            from .models import sync_user_profile_to_pg

            sync_user_profile_to_pg(
                phone,
                display_name=str(info.get("display_name") or phone),
                role=str(info.get("role") or "user"),
                plan=str(info.get("plan") or "free"),
                billing_cycle=(str(info.get("billing_cycle") or "").strip() or None),
            )
        except Exception:
            pass
    return token, err


def login_user(phone: str, password: str) -> tuple[str | None, str | None]:
    return auth_service.login_user(phone, password)


def delete_session(token: str) -> None:
    auth_service.delete_session(token)


def get_session(token: str) -> dict[str, Any] | None:
    sess = auth_service.get_session(token)
    if not sess:
        return None
    return dict(sess)


def unlock_feature(token: str, phone: str, password: str) -> tuple[bool, str | None]:
    return auth_service.unlock_feature(token, phone, password)


def set_user_subscription(
    phone: str,
    tier: str,
    cycle: str | None,
    *,
    source: str = "subscription_set",
    actor_phone: str | None = None,
    meta: dict[str, Any] | None = None,
) -> tuple[bool, str | None]:
    ok, err = auth_service.set_user_subscription(phone, tier, cycle)
    if not ok:
        return ok, err
    try:
        from .models import record_subscription_event, sync_user_profile_to_pg

        info = auth_service.user_info_for_phone(phone)
        sync_user_profile_to_pg(
            phone,
            display_name=str(info.get("display_name") or phone),
            role=str(info.get("role") or "user"),
            plan=str(info.get("plan") or "free"),
            billing_cycle=(str(info.get("billing_cycle") or "").strip() or None),
        )
        record_subscription_event(
            phone,
            str(info.get("plan") or tier or "free"),
            (str(info.get("billing_cycle") or "").strip() or None),
            event_type="subscription_set",
            effective_at=datetime.now(timezone.utc),
            source=source,
            actor_phone=actor_phone,
            meta=meta or {"path": "auth_bridge.set_user_subscription"},
        )
    except Exception:
        pass
    return True, None


def is_admin_phone(phone: str) -> bool:
    return bool(auth_service.is_admin_phone(phone))


def list_users_admin_view() -> list[dict[str, Any]]:
    return list(auth_service.list_users_admin_view())


def active_sessions_summary() -> dict[str, int]:
    """
    返回当前有效会话概览（用于管理员看板）：
    - active_sessions: 会话总数
    - active_users: 去重用户数（按 phone）
    """
    try:
        sessions = auth_service._load_sessions()  # type: ignore[attr-defined]  # noqa: SLF001
        auth_service._purge_expired_sessions(sessions)  # type: ignore[attr-defined]  # noqa: SLF001
        phone_set: set[str] = set()
        for raw in sessions.values():
            if not isinstance(raw, dict):
                continue
            p = str(raw.get("phone") or "").strip()
            if p:
                phone_set.add(p)
        return {
            "active_sessions": int(len(sessions)),
            "active_users": int(len(phone_set)),
        }
    except Exception:
        return {"active_sessions": 0, "active_users": 0}


def admin_create_user(
    phone: str,
    password: str,
    role: str = "user",
    plan: str = "free",
    billing_cycle: str | None = None,
) -> tuple[bool, str | None]:
    ok, err = auth_service.admin_create_user(
        phone=phone,
        password=password,
        role=role,
        plan=plan,
        billing_cycle=billing_cycle,
    )
    if ok:
        try:
            info = auth_service.user_info_for_phone(phone)
            from .models import sync_user_profile_to_pg

            sync_user_profile_to_pg(
                phone,
                display_name=str(info.get("display_name") or phone),
                role=str(info.get("role") or role or "user"),
                plan=str(info.get("plan") or plan or "free"),
                billing_cycle=(str(info.get("billing_cycle") or "").strip() or billing_cycle),
            )
        except Exception:
            pass
    return ok, err


def set_user_role(phone: str, role: str) -> tuple[bool, str | None]:
    ok, err = auth_service.set_user_role(phone, role)
    if ok:
        try:
            info = auth_service.user_info_for_phone(phone)
            from .models import sync_user_profile_to_pg

            sync_user_profile_to_pg(
                phone,
                display_name=str(info.get("display_name") or phone),
                role=str(info.get("role") or role or "user"),
                plan=str(info.get("plan") or "free"),
                billing_cycle=(str(info.get("billing_cycle") or "").strip() or None),
            )
        except Exception:
            pass
    return ok, err


def admin_delete_user(phone: str) -> tuple[bool, str | None]:
    return auth_service.admin_delete_user(phone)


def list_payment_orders(phone: str, limit: int = 40) -> list[dict[str, Any]]:
    try:
        from .models import list_payment_orders_for_phone

        rows = list_payment_orders_for_phone(phone, limit)
        if rows:
            return rows
    except Exception:
        pass
    from app.fyv_shared import payment_store

    return list(payment_store.list_orders_for_phone(phone, limit))


def apply_payment_event(
    event_id: str,
    phone: str,
    tier: str,
    billing_cycle: str | None,
    status: str,
    amount_cents: int,
    provider: str,
    *,
    trace_id: str | None = None,
    request_id: str | None = None,
    currency: str | None = None,
    provider_order_id: str | None = None,
    channel: str | None = None,
    paid_at: datetime | None = None,
    failed_at: datetime | None = None,
    refunded_at: datetime | None = None,
    settlement_amount_cents: int | None = None,
    settlement_currency: str | None = None,
    fx_rate_snapshot: float | None = None,
    refunded_amount_cents: int | None = None,
    refund_id: str | None = None,
    refund_reason: str | None = None,
    idempotency_key: str | None = None,
    client_request_id: str | None = None,
    product_snapshot: dict[str, Any] | None = None,
    order_items: list[dict[str, Any]] | None = None,
    amount_subtotal_cents: int | None = None,
    discount_cents: int | None = None,
    tax_cents: int | None = None,
    payable_cents: int | None = None,
    paid_cents: int | None = None,
    source_ip: str | None = None,
    user_agent: str | None = None,
    source: str = "payment_webhook",
) -> tuple[bool, str, dict[str, Any] | None]:
    base_row = {
        "event_id": str(event_id or "").strip(),
        "phone": str(phone or "").strip(),
        "tier": str(tier or "free").strip().lower(),
        "billing_cycle": (str(billing_cycle or "").strip().lower() or None),
        "status": str(status or "unknown").strip().lower(),
        "amount_cents": int(amount_cents or 0),
        "provider": str(provider or "unknown").strip(),
        "created_at": int(datetime.now(timezone.utc).timestamp()),
    }
    snap_kind = str((product_snapshot or {}).get("kind") or "").strip().lower() if isinstance(product_snapshot, dict) else ""
    skips_subscription_from_product = snap_kind in ("payg_minutes", "wallet_topup")
    try:
        from .models import process_payment_event_transaction, sync_user_profile_to_pg

        tx_ok = process_payment_event_transaction(
            event_id=event_id,
            phone=phone,
            tier=str(tier or "free"),
            billing_cycle=(str(billing_cycle or "").strip() or None),
            status=str(status or "unknown"),
            amount_cents=int(amount_cents or 0),
            provider=str(provider or "unknown"),
            created_at_unix=base_row["created_at"],
            raw=base_row,
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
            refund_id=refund_id,
            refund_reason=refund_reason,
            idempotency_key=idempotency_key,
            client_request_id=client_request_id,
            product_snapshot=product_snapshot,
            order_items=order_items,
            amount_subtotal_cents=amount_subtotal_cents,
            discount_cents=discount_cents,
            tax_cents=tax_cents,
            payable_cents=payable_cents,
            paid_cents=paid_cents,
            source_ip=source_ip,
            user_agent=user_agent,
            source=(source or "payment_webhook").strip()[:64] or "payment_webhook",
            meta={
                "event_id": event_id,
                "status": status,
                "amount_cents": int(amount_cents or 0),
                "provider": provider,
            },
        )
        if not tx_ok:
            return False, "payment_event_tx_failed", base_row

        normalized_status = str(status or "").strip().lower()
        if normalized_status in {"paid", "success", "succeeded", "captured"}:
            if not skips_subscription_from_product:
                # 与 PG/JSON 用户档同步写入，后续请求 user_info_for_phone 立即按新档位生效
                auth_service.set_user_subscription(
                    str(phone or "").strip(),
                    str(tier or "free").strip().lower(),
                    (str(billing_cycle or "").strip().lower() or None),
                )
        elif normalized_status in {"refunded", "cancelled"}:
            if not skips_subscription_from_product:
                auth_service.set_user_subscription(str(phone or "").strip(), "free", None)
        elif normalized_status in {"partial_refund", "partially_refunded"}:
            # 部分退款不自动降级，避免误伤仍有效的订阅周期；全额退款走 refunded 分支。
            pass

        info = auth_service.user_info_for_phone(phone)
        sync_user_profile_to_pg(
            phone,
            display_name=str(info.get("display_name") or phone),
            role=str(info.get("role") or "user"),
            plan=str(info.get("plan") or "free"),
            billing_cycle=(str(info.get("billing_cycle") or "").strip() or None),
        )
    except Exception:
        return False, "payment_event_tx_exception", base_row

    # legacy: best-effort mirror only; do not affect main transaction success
    try:
        from app.fyv_shared import payment_store

        if not skips_subscription_from_product:
            payment_store.apply_payment_event(
                event_id, phone, tier, billing_cycle, status, amount_cents, provider
            )
    except Exception:
        pass
    return True, "ok", base_row
