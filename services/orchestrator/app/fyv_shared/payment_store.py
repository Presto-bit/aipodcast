"""
支付订单记录（文件型，与 auth_service 同目录策略）。
Webhook 验签通过后写入订单；同一 event_id 仅处理一次（幂等）。
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from .config import DATA_DIR, OUTPUT_DIR

ORDERS_FILE = os.path.join(DATA_DIR, "payment_orders.json")
LEGACY_ORDERS_FILE = os.path.join(OUTPUT_DIR, "payment_orders.json")

# apply_payment_event() 内会调用 _load()，需要可重入锁避免同线程二次加锁卡死
_lock = threading.RLock()


def _migrate_legacy_orders_if_needed() -> None:
    if os.path.exists(ORDERS_FILE):
        return
    if not os.path.exists(LEGACY_ORDERS_FILE):
        return
    os.makedirs(os.path.dirname(ORDERS_FILE) or ".", exist_ok=True)
    try:
        with open(LEGACY_ORDERS_FILE, "r", encoding="utf-8") as src:
            data = src.read()
        with open(ORDERS_FILE, "w", encoding="utf-8") as dst:
            dst.write(data)
    except Exception:
        # 迁移失败不阻断业务，按空订单继续
        return


def _load() -> Dict[str, Any]:
    with _lock:
        _migrate_legacy_orders_if_needed()
        if not os.path.exists(ORDERS_FILE):
            return {"orders": []}
        try:
            with open(ORDERS_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return raw if isinstance(raw, dict) else {"orders": []}
        except Exception:
            return {"orders": []}


def _save(data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(ORDERS_FILE) or ".", exist_ok=True)
    with open(ORDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _now() -> float:
    return time.time()


def apply_payment_event(
    event_id: str,
    phone: str,
    tier: str,
    billing_cycle: Optional[str],
    status: str,
    amount_cents: int,
    provider: str,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    幂等：相同 event_id 第二次返回 ok=True, reason=duplicate。
    status == paid 时同步套餐到 auth_service。
    """
    from . import auth_service  # noqa: WPS433 — 同包内运行时导入

    eid = (event_id or "").strip()
    p = (phone or "").strip()
    if not eid or not p:
        return False, "missing_event_id_or_phone", None

    st = (status or "").strip().lower()
    tier_n = (tier or "free").strip().lower()
    cycle = (billing_cycle or "").strip().lower() if billing_cycle else None

    with _lock:
        data = _load()
        orders = data.get("orders")
        if not isinstance(orders, list):
            orders = []
        for o in orders:
            if isinstance(o, dict) and str(o.get("event_id") or "") == eid:
                return True, "duplicate", dict(o)

        row = {
            "event_id": eid,
            "phone": p,
            "tier": tier_n,
            "billing_cycle": cycle,
            "status": st,
            "amount_cents": int(amount_cents or 0),
            "provider": (provider or "unknown").strip()[:64],
            "created_at": int(_now()),
        }
        orders.insert(0, row)
        data["orders"] = orders[:500]
        _save(data)

    if st == "paid":
        ok, err = auth_service.set_user_subscription(p, tier_n, cycle if tier_n != "free" else None)
        if not ok:
            return False, str(err or "subscription_update_failed"), row
    return True, "ok", row


def list_orders_for_phone(phone: str, limit: int = 40) -> List[Dict[str, Any]]:
    p = (phone or "").strip()
    lim = max(1, min(100, int(limit)))
    data = _load()
    orders = data.get("orders")
    if not isinstance(orders, list):
        return []
    out = [dict(x) for x in orders if isinstance(x, dict) and str(x.get("phone") or "") == p]
    out.sort(key=lambda x: int(x.get("created_at") or 0), reverse=True)
    return out[:lim]
