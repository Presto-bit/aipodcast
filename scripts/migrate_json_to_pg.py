#!/usr/bin/env python3
"""
将 legacy_backend/data 下的 JSON 数据迁移到 PostgreSQL：
1) users.json -> users
2) payment_orders.json -> payment_orders
3) saved_voices.json -> user_saved_voices（按 --phone 指定归属）

用法：
  python3 scripts/migrate_json_to_pg.py --dry-run
  python3 scripts/migrate_json_to_pg.py --phone 18101383358
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_DIR = os.path.join(ROOT, "services", "orchestrator")

if ORCH_DIR not in sys.path:
    sys.path.insert(0, ORCH_DIR)

import psycopg2  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import get_conn, get_cursor  # noqa: E402
from app.models import ensure_saved_voices_schema, replace_saved_voices_for_user  # noqa: E402
from app.fyv_shared.config import DATA_DIR, VOICE_STORE_FILE  # noqa: E402


def _users_json_path() -> str:
    return os.path.join(DATA_DIR, "users.json")


def _orders_json_path() -> str:
    return os.path.join(DATA_DIR, "payment_orders.json")


def _load_json(path: str, default: Any) -> Any:
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw
    except json.JSONDecodeError as exc:
        print(f"[warn] JSON 解析失败 {path}: {exc}", file=sys.stderr)
        return default
    except OSError as exc:
        print(f"[warn] 无法读取 {path}: {exc}", file=sys.stderr)
        return default


def _has_column(cur: psycopg2.extensions.cursor, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        LIMIT 1
        """,
        (table, column),
    )
    return bool(cur.fetchone())


def _normalize_voice_rows(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voiceId") or "").strip()
        if not voice_id or voice_id in seen:
            continue
        seen.add(voice_id)
        out.append(
            {
                "voiceId": voice_id,
                "displayName": str(item.get("displayName") or voice_id).strip() or voice_id,
                "createdAt": item.get("createdAt"),
                "lastUsedAt": item.get("lastUsedAt"),
            }
        )
    return out[:200]


def migrate_users(*, dry_run: bool) -> tuple[int, int]:
    raw = _load_json(_users_json_path(), {})
    if not isinstance(raw, dict):
        print("[users] users.json 格式错误，跳过")
        return 0, 0

    rows: list[dict[str, str]] = []
    for phone, user in raw.items():
        p = str(phone or "").strip()
        if not p or not isinstance(user, dict):
            continue
        rows.append(
            {
                "phone": p,
                "display_name": str(user.get("display_name") or p).strip() or p,
                "role": str(user.get("role") or "user").strip().lower() or "user",
                "plan": str(user.get("plan") or "free").strip().lower() or "free",
                "billing_cycle": (str(user.get("billing_cycle") or "").strip().lower() or ""),
                "password_hash": str(user.get("password_hash") or "").strip(),
            }
        )

    if not rows:
        print("[users] 无可迁移记录")
        return 0, 0

    if dry_run:
        print(f"[users][dry-run] 将写入 {len(rows)} 条")
        return len(rows), 0

    written = 0
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_auth_accounts (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  password_hash TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  failed_attempts INTEGER NOT NULL DEFAULT 0,
                  locked_until TIMESTAMPTZ,
                  last_login_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO users (phone, display_name, role, plan, billing_cycle, updated_at)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (phone) DO UPDATE SET
                      display_name = EXCLUDED.display_name,
                      role = EXCLUDED.role,
                      plan = EXCLUDED.plan,
                      billing_cycle = EXCLUDED.billing_cycle,
                      updated_at = NOW()
                    RETURNING id
                    """,
                    (
                        r["phone"],
                        r["display_name"],
                        r["role"] if r["role"] in ("user", "admin") else "user",
                        r["plan"] if r["plan"] in ("free", "basic", "pro", "max") else "free",
                        (r["billing_cycle"] if r["billing_cycle"] in ("monthly", "yearly") else None),
                    ),
                )
                uid = str((cur.fetchone() or {}).get("id") or "")
                if uid and r.get("password_hash"):
                    cur.execute(
                        """
                        INSERT INTO user_auth_accounts (user_id, password_hash, status, updated_at)
                        VALUES (%s::uuid, %s, 'active', NOW())
                        ON CONFLICT (user_id) DO UPDATE SET
                          password_hash = EXCLUDED.password_hash,
                          status = 'active',
                          updated_at = NOW()
                        """,
                        (uid, r["password_hash"]),
                    )
                written += 1
        conn.commit()
    print(f"[users] 已写入 {written} 条")
    return len(rows), written


def ensure_payment_orders_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_orders (
                  id BIGSERIAL PRIMARY KEY,
                  event_id TEXT UNIQUE NOT NULL,
                  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL DEFAULT 'free',
                  billing_cycle TEXT,
                  status TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL DEFAULT 0,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  created_at_unix BIGINT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  trace_id TEXT,
                  request_id TEXT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_payment_orders_phone_created_at
                  ON payment_orders(phone, created_at DESC);
                """
            )
        conn.commit()


def migrate_orders(*, dry_run: bool) -> tuple[int, int]:
    raw = _load_json(_orders_json_path(), {})
    if not isinstance(raw, dict):
        print("[orders] payment_orders.json 格式错误，跳过")
        return 0, 0
    orders = raw.get("orders")
    if not isinstance(orders, list):
        print("[orders] 无 orders 数组，跳过")
        return 0, 0

    rows: list[dict[str, Any]] = []
    for o in orders:
        if not isinstance(o, dict):
            continue
        eid = str(o.get("event_id") or "").strip()
        phone = str(o.get("phone") or "").strip()
        if not eid or not phone:
            continue
        rows.append(
            {
                "event_id": eid,
                "phone": phone,
                "tier": str(o.get("tier") or "free").strip().lower() or "free",
                "billing_cycle": (str(o.get("billing_cycle") or "").strip().lower() or None),
                "status": str(o.get("status") or "").strip().lower() or "unknown",
                "amount_cents": int(o.get("amount_cents") or 0),
                "provider": str(o.get("provider") or "unknown").strip()[:64] or "unknown",
                "created_at_unix": int(o.get("created_at") or 0) or None,
                "raw": o,
            }
        )

    if not rows:
        print("[orders] 无可迁移记录")
        return 0, 0

    if dry_run:
        print(f"[orders][dry-run] 将写入 {len(rows)} 条")
        return len(rows), 0

    ensure_payment_orders_schema()
    written = 0
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO payment_orders
                      (event_id, phone, tier, billing_cycle, status, amount_cents, provider, created_at_unix, raw, updated_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (event_id) DO UPDATE SET
                      phone = EXCLUDED.phone,
                      tier = EXCLUDED.tier,
                      billing_cycle = EXCLUDED.billing_cycle,
                      status = EXCLUDED.status,
                      amount_cents = EXCLUDED.amount_cents,
                      provider = EXCLUDED.provider,
                      created_at_unix = EXCLUDED.created_at_unix,
                      raw = EXCLUDED.raw,
                      updated_at = NOW()
                    """,
                    (
                        r["event_id"],
                        r["phone"],
                        r["tier"],
                        r["billing_cycle"],
                        r["status"],
                        r["amount_cents"],
                        r["provider"],
                        r["created_at_unix"],
                        json.dumps(r["raw"], ensure_ascii=False),
                    ),
                )
                written += 1
        conn.commit()
    print(f"[orders] 已写入 {written} 条")
    return len(rows), written


def migrate_saved_voices(*, dry_run: bool, phone: str) -> tuple[int, int]:
    if not phone:
        print("[voices] 缺少 --phone，跳过")
        return 0, 0
    raw = _load_json(VOICE_STORE_FILE, [])
    rows = _normalize_voice_rows(raw)
    if not rows:
        print("[voices] 无可迁移记录")
        return 0, 0
    if dry_run:
        print(f"[voices][dry-run] 将为 {phone} 写入 {len(rows)} 条")
        return len(rows), 0
    ensure_saved_voices_schema()
    ok, err, n = replace_saved_voices_for_user(phone, rows)
    if not ok:
        print(f"[voices] 写入失败: {err}")
        return len(rows), 0
    print(f"[voices] 已为 {phone} 写入 {n} 条")
    return len(rows), n


def check_db_connection() -> bool:
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute("SELECT 1")
                _ = cur.fetchone()
        return True
    except Exception as exc:
        print(f"[db] 连接失败: {exc}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate JSON runtime data into PostgreSQL")
    ap.add_argument("--dry-run", action="store_true", help="仅预览迁移数量，不写库")
    ap.add_argument(
        "--phone",
        default="",
        help="saved_voices.json 迁移目标手机号（不传则跳过 voices 迁移）",
    )
    args = ap.parse_args()

    print(f"DB: {settings.db_host}:{settings.db_port}/{settings.db_name}")
    print(f"DATA_DIR: {DATA_DIR}")

    if not check_db_connection():
        return 1

    try:
        plan_u, done_u = migrate_users(dry_run=args.dry_run)
        plan_o, done_o = migrate_orders(dry_run=args.dry_run)
        plan_v, done_v = migrate_saved_voices(dry_run=args.dry_run, phone=str(args.phone or "").strip())
    except Exception as exc:
        print(f"迁移过程异常中止: {exc}", file=sys.stderr)
        return 1

    print(
        "SUMMARY:",
        json.dumps(
            {
                "dry_run": bool(args.dry_run),
                "users": {"planned": plan_u, "written": done_u},
                "orders": {"planned": plan_o, "written": done_o},
                "saved_voices": {"planned": plan_v, "written": done_v, "phone": str(args.phone or "").strip()},
            },
            ensure_ascii=False,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
