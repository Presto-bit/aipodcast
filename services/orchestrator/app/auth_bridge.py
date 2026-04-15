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


def _sync_profile_from_info(info: dict[str, Any]) -> None:
    try:
        from .models import sync_user_profile_to_pg

        uid = str(info.get("user_id") or "").strip()
        ph = str(info.get("phone") or "").strip()
        sync_user_profile_to_pg(
            ph,
            user_id=uid or None,
            display_name=str(info.get("display_name") or ph or uid),
            role=str(info.get("role") or "user"),
            plan=str(info.get("plan") or "free"),
            billing_cycle=(str(info.get("billing_cycle") or "").strip() or None),
        )
    except Exception:
        pass


def user_info_for_phone(phone: str) -> dict[str, Any]:
    base = dict(auth_service.user_info_for_principal(phone))
    try:
        from .models import get_user_profile_from_pg

        ph_key = str(base.get("phone") or "").strip()
        if ph_key:
            pg_row = get_user_profile_from_pg(ph_key)
            if pg_row:
                for key in ("display_name", "role", "plan", "billing_cycle"):
                    if key in pg_row and pg_row.get(key) is not None:
                        base[key] = pg_row.get(key)
    except Exception:
        pass
    try:
        from .models import wallet_balance_cents_for_phone

        ph_w = str(base.get("phone") or "").strip()
        base["wallet_balance_cents"] = int(wallet_balance_cents_for_phone(ph_w)) if ph_w else 0
    except Exception:
        base["wallet_balance_cents"] = 0
    return base


def user_info_for_session_token(token: str) -> dict[str, Any]:
    """
    与 subscription/me 一致：auth_service 用户档 + PG user_profiles 覆盖（plan、billing_cycle 等）。
    用于 /auth/me、登录/注册响应，避免前端个人资料与订阅页方案不一致。
    """
    sess = get_session(token)
    if not isinstance(sess, dict):
        return {}
    p = session_principal(sess)
    if not p:
        return {}
    return user_info_for_phone(p)


def update_display_name(principal: str, display_name: str) -> tuple[bool, str | None]:
    ok, err = auth_service.update_display_name(principal, display_name)
    if not ok:
        return False, err
    try:
        _sync_profile_from_info(auth_service.user_info_for_principal(principal))
    except Exception:
        pass
    return True, None


def update_username(principal: str, username: str) -> tuple[bool, str | None]:
    ok, err = auth_service.update_username(principal, (username or "").strip())
    if not ok:
        return False, err
    try:
        _sync_profile_from_info(auth_service.user_info_for_principal(principal))
    except Exception:
        pass
    return True, None


def auth_config_dict() -> dict[str, Any]:
    return dict(auth_service.auth_config_dict())


def register_user(
    password: str,
    invite_code: str,
    *,
    phone: str | None = None,
    email: str | None = None,
    username: str | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    token, err, meta = auth_service.register_user(
        password, invite_code, phone=phone, email=email, username=username
    )
    if token and not err:
        try:
            _sync_profile_from_info(auth_service.user_info_from_session_token(token))
        except Exception:
            pass
    return token, err, meta


def register_send_otp(email: str, username: str, invite_code: str) -> tuple[bool, str, dict[str, Any]]:
    return auth_service.register_send_otp(email, username, invite_code)


def register_verify_otp(email: str, code: str) -> tuple[str | None, str]:
    return auth_service.register_verify_otp(email, code)


def register_complete_with_ticket(ticket: str, password: str) -> tuple[str | None, str | None, dict[str, Any]]:
    token, err, meta = auth_service.register_complete_with_ticket(ticket, password)
    if token and not err:
        try:
            _sync_profile_from_info(auth_service.user_info_from_session_token(token))
        except Exception:
            pass
    return token, err, meta


def login_user(login_id: str, password: str) -> tuple[str | None, str | None]:
    return auth_service.login_user(login_id, password)


def delete_session(token: str) -> None:
    auth_service.delete_session(token)


def get_session(token: str) -> dict[str, Any] | None:
    sess = auth_service.get_session(token)
    if not sess:
        return None
    return dict(sess)


def session_principal(sess: dict[str, Any]) -> str:
    """API 用户主引用：PG 主模式下为 users.id(UUID)；本地 JSON 会话回退为 phone。"""
    return str(auth_service.session_effective_user_id(sess)).strip()


def user_info_from_session_token(token: str) -> dict[str, Any]:
    return dict(auth_service.user_info_from_session_token(token))


def unlock_feature(token: str, password: str, login_id: str = "") -> tuple[bool, str | None]:
    return auth_service.unlock_feature(token, password, login_id=login_id)


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
        from .models import record_subscription_event

        info = auth_service.user_info_for_principal(phone)
        _sync_profile_from_info(info)
        sub_key = str(info.get("phone") or info.get("user_id") or phone or "").strip()
        record_subscription_event(
            sub_key,
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
    - active_users: 去重用户数（优先 user_id）
    """
    try:
        sessions = auth_service._load_sessions()  # type: ignore[attr-defined]  # noqa: SLF001
        auth_service._purge_expired_sessions(sessions)  # type: ignore[attr-defined]  # noqa: SLF001
        seen: set[str] = set()
        for raw in sessions.values():
            if not isinstance(raw, dict):
                continue
            u = str(auth_service.session_effective_user_id(raw)).strip()
            if u:
                seen.add(u)
            else:
                p = str(raw.get("phone") or "").strip()
                if p:
                    seen.add("p:" + p)
        return {
            "active_sessions": int(len(sessions)),
            "active_users": int(len(seen)),
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
            _sync_profile_from_info(auth_service.user_info_for_principal(phone))
        except Exception:
            pass
    return ok, err


def set_user_role(phone: str, role: str) -> tuple[bool, str | None]:
    ok, err = auth_service.set_user_role(phone, role)
    if ok:
        try:
            _sync_profile_from_info(auth_service.user_info_for_principal(phone))
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
        from .models import process_payment_event_transaction

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

        _sync_profile_from_info(auth_service.user_info_for_principal(str(phone or "").strip()))
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
