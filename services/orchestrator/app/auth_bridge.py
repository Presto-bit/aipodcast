import logging
from datetime import datetime, timezone
from typing import Any

from app.fyv_shared import auth_service

logger = logging.getLogger(__name__)


def _experience_seed_after_registration_token(token: str) -> None:
    try:
        sess = auth_service.get_session(token)
        if not isinstance(sess, dict):
            return
        pr = str(auth_service.session_effective_user_id(sess) or "").strip()
        if not pr:
            return
        from .models import experience_seed_for_new_user_after_registration

        experience_seed_for_new_user_after_registration(pr)
    except Exception:
        logger.exception("experience_seed_after_registration failed")


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
            acct_tier=str(info.get("acct_tier") or info.get("plan") or "free"),
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
                for key in ("display_name", "role", "acct_tier", "billing_cycle"):
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
    base.pop("plan", None)
    base.pop("acct_tier", None)
    base.pop("billing_cycle", None)
    return base


def user_info_for_session_token(token: str) -> dict[str, Any]:
    """
    auth_service 用户档 + PG user_profiles 覆盖；返回中不包含 acct_tier / billing_cycle（对外会话不暴露订阅档位）。
    用于 /auth/me、登录/注册响应。
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


def change_password(principal: str, current_password: str, new_password: str) -> tuple[bool, str | None]:
    return auth_service.change_password_for_principal(principal, current_password, new_password)


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
        _experience_seed_after_registration_token(token)
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
        _experience_seed_after_registration_token(token)
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
            str(info.get("acct_tier") or info.get("plan") or tier or "free"),
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
    acct_tier: str = "free",
    billing_cycle: str | None = None,
) -> tuple[bool, str | None]:
    ok, err = auth_service.admin_create_user(
        phone=phone,
        password=password,
        role=role,
        initial_tier=acct_tier,
        billing_cycle=billing_cycle,
    )
    if ok:
        try:
            _sync_profile_from_info(auth_service.user_info_for_principal(phone))
        except Exception:
            pass
        try:
            from .models import experience_seed_for_new_user_after_registration

            experience_seed_for_new_user_after_registration(phone)
        except Exception:
            logger.exception("experience_seed admin_create_user failed phone=%s", phone[:4] if phone else "")
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


def admin_invalidate_user(phone: str) -> tuple[bool, str | None]:
    return auth_service.admin_invalidate_user(phone)


def admin_reactivate_user(phone: str) -> tuple[bool, str | None]:
    return auth_service.admin_reactivate_user(phone)


def admin_credit_wallet_cents(phone: str, cents: int) -> tuple[bool, str | None, int]:
    """
    管理员调账：增加钱包余额（分）。用户须已存在。
    返回 (成功, 错误码/文案, 扣后余额分；失败时余额为当前可读值或 0)。
    """
    p = (phone or "").strip()
    if not p:
        return False, "phone_required", 0
    base = auth_service.user_info_for_principal(p)
    if not str(base.get("phone") or "").strip():
        return False, "user_not_found", 0
    try:
        from . import models

        if not models.wallet_credit_cents(p, int(cents)):
            return False, "wallet_credit_failed", models.wallet_balance_cents_for_phone(p)
        return True, None, models.wallet_balance_cents_for_phone(p)
    except Exception:
        logger.exception("admin_credit_wallet_cents failed")
        try:
            from . import models

            return False, "wallet_credit_error", models.wallet_balance_cents_for_phone(p)
        except Exception:
            return False, "wallet_credit_error", 0


def list_payment_orders(phone: str, limit: int = 40) -> list[dict[str, Any]]:
    from .models import list_payment_orders_for_phone

    return list_payment_orders_for_phone(phone, limit)


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
    from .models import normalize_payment_principal

    phone = normalize_payment_principal(str(phone or "").strip())
    base_row = {
        "event_id": str(event_id or "").strip(),
        "phone": phone,
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

        tx_ok, tx_err = process_payment_event_transaction(
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
            return False, (tx_err or "payment_event_tx_failed"), base_row

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

        try:
            _sync_profile_from_info(auth_service.user_info_for_principal(str(phone or "").strip()))
        except Exception:
            logger.exception(
                "apply_payment_event post_tx sync_profile failed phone=%s skips_subscription=%s",
                str(phone or "")[:48],
                skips_subscription_from_product,
            )
            # 钱包/分钟包入账已在 PG 提交；不因同步用户档失败让回调方误判失败（否则支付宝反复重试、前端看不到成功态）
            if not skips_subscription_from_product:
                return False, "payment_event_tx_exception", base_row
    except Exception:
        return False, "payment_event_tx_exception", base_row

    return True, "ok", base_row
