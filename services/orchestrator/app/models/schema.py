"""数据库 schema 幂等 DDL（ensure_*）；业务 CRUD 见 models._core。"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from psycopg2 import IntegrityError

from ..db import get_conn, get_cursor
from ..subscription_manifest import (
    EXPERIENCE_NEW_USER_ASR_MINUTES,
    EXPERIENCE_NEW_USER_TEXT_CHARS,
    EXPERIENCE_NEW_USER_VOICE_MINUTES,
    MONTHLY_MINUTES_PRODUCT_BY_TIER,
    USER_SUBSCRIPTION_TIERS,
)

from . import _core as _core_mod
from ._core import (
    DEFAULT_LIBRARY_NOTEBOOK_NAME,
    LEGACY_DEFAULT_NOTEBOOK,
    NOTES_PODCAST_STUDIO_PROJECT,
    _normalize_phone_digits,
    _normalize_user_uuid,
    _resolve_user_uuid_from_ref,
    _resolve_user_uuid_or_none,
    create_notebook_only,
    list_notebook_names,
    phone_for_job_created_by,
)

logger = logging.getLogger(__name__)

_jobs_trash_schema_ready = False
_user_wallet_schema_ready = False
_site_traffic_schema_ready = False


def ensure_default_project(project_name: str, created_by: str | None = None) -> str:
    """按 (name, user_id) 复用已有项目行，避免重复 INSERT 与孤立 project 行导致笔记上传异常。"""
    pn = (project_name or "").strip()
    if not pn:
        raise ValueError("project_name_required")
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            owner_user_id = _resolve_user_uuid_from_ref(cur, created_by)
            cur.execute(
                """
                SELECT id FROM projects
                WHERE name = %s AND (user_id IS NOT DISTINCT FROM %s)
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (pn, owner_user_id),
            )
            existing = cur.fetchone()
            if existing and existing.get("id") is not None:
                conn.commit()
                return str(existing["id"])
            cur.execute(
                """
                INSERT INTO projects (name, user_id)
                VALUES (%s, %s)
                RETURNING id
                """,
                (pn, owner_user_id),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row["id"])
def ensure_notebooks_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS notebooks (
                  name TEXT PRIMARY KEY,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_notebooks (
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  name TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (user_id, name)
                );
                """
            )
            try:
                cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_inputs_note_deleted ON inputs (deleted_at)
                    WHERE input_type IN ('note_text', 'note_file')
                    """
                )
            except Exception:
                pass
            try:
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE"
                )
                cur.execute("ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS public_access TEXT")
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0"
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_user_notebooks_public_views
                    ON user_notebooks (is_public, view_count DESC)
                    WHERE is_public = TRUE
                    """
                )
            except Exception:
                pass
            try:
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS cover_mode TEXT NOT NULL DEFAULT 'auto'"
                )
                cur.execute("ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS cover_preset_id TEXT")
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS cover_thumb_object_key TEXT"
                )
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS cover_image_object_key TEXT"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS listed_in_discover BOOLEAN NOT NULL DEFAULT FALSE"
                )
                cur.execute(
                    "ALTER TABLE user_notebooks ADD COLUMN IF NOT EXISTS digest_json JSONB NOT NULL DEFAULT '{}'::jsonb"
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_user_notebooks_discover_views
                    ON user_notebooks (listed_in_discover, view_count DESC)
                    WHERE listed_in_discover = TRUE
                    """
                )
            except Exception:
                pass
            try:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS notebook_popular_view_dedup (
                      viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                      owner_user_id UUID NOT NULL,
                      notebook_name TEXT NOT NULL,
                      last_increment_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      PRIMARY KEY (viewer_user_id, owner_user_id, notebook_name)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_notebook_popular_view_dedup_owner
                    ON notebook_popular_view_dedup (owner_user_id, notebook_name)
                    """
                )
            except Exception:
                pass
            conn.commit()
    try:
        from ..author_ip_store import ensure_author_ip_schema

        ensure_author_ip_schema()
    except Exception:
        logger.exception("ensure_notebooks_schema: author_ip schema failed")


def ensure_jobs_trash_schema() -> None:
    global _jobs_trash_schema_ready
    if _jobs_trash_schema_ready:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at
                ON jobs (deleted_at, completed_at DESC, created_at DESC)
                """
            )
            try:
                cur.execute(
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_podcast_template BOOLEAN NOT NULL DEFAULT FALSE"
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_jobs_podcast_template_list
                    ON jobs (completed_at DESC NULLS LAST, created_at DESC)
                    WHERE is_podcast_template IS TRUE
                      AND deleted_at IS NULL
                      AND status = 'succeeded'
                    """
                )
            except Exception:
                pass
            conn.commit()
    _jobs_trash_schema_ready = True


def ensure_default_library_notebook(user_ref: str | None) -> None:
    """确保存在「默认资料库」：即使用户已新建其他笔记本也会自动补齐，与创作侧资料上传默认笔记本一致。幂等。"""
    raw = (user_ref or "").strip()
    if not raw:
        return
    try:
        names = list_notebook_names(user_ref=user_ref)
        if DEFAULT_LIBRARY_NOTEBOOK_NAME in names:
            return
        create_notebook_only(DEFAULT_LIBRARY_NOTEBOOK_NAME, user_ref=user_ref)
    except Exception:
        return
def ensure_usage_events_user_id_schema() -> None:
    """运行时补齐 usage_events.user_id（与 022 迁移一致）；全进程仅执行一次 ALTER。"""
    if _core_mod._usage_events_user_id_schema_ready:
        return
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    ALTER TABLE usage_events
                    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_usage_events_user_id_created
                    ON usage_events(user_id, created_at DESC)
                    """
                )
            conn.commit()
        _core_mod._usage_events_user_id_schema_ready = True
    except Exception:
        logger.exception("ensure_usage_events_user_id_schema 失败")
def ensure_saved_voices_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_saved_voices (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  voices JSONB NOT NULL DEFAULT '[]'::jsonb,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
def ensure_user_preferences_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_preferences (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  data JSONB NOT NULL DEFAULT '{}'::jsonb,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
def ensure_users_profile_columns() -> None:
    """为 users 表补充档位与按手机号解析用户所需列（兼容旧库、未跑 011 迁移的实例）。"""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS acct_tier TEXT NOT NULL DEFAULT 'free'")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT")
            cur.execute(
                """
                UPDATE users
                SET phone_normalized = regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
                WHERE (phone_normalized IS NULL OR phone_normalized = '')
                  AND phone IS NOT NULL AND btrim(phone) <> ''
                """
            )
            conn.commit()
def ensure_subscription_events_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_events (
                  id BIGSERIAL PRIMARY KEY,
                  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL,
                  event_type TEXT NOT NULL DEFAULT 'unknown',
                  billing_cycle TEXT,
                  effective_at TIMESTAMPTZ,
                  expires_at TIMESTAMPTZ,
                  order_event_id TEXT,
                  source TEXT NOT NULL DEFAULT 'unknown',
                  actor_phone TEXT,
                  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'unknown'")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS order_event_id TEXT")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_events_phone_created_at ON subscription_events(phone, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_events_user_created_at ON subscription_events(user_id, created_at DESC)"
            )
            conn.commit()
def ensure_payment_orders_schema() -> None:
    """
    幂等 DDL。生产环境由 FastAPI lifespan（main.run_startup_tasks）在进程启动时执行一次；
    热路径（如 process_payment_event_transaction）不再重复调用以降低 catalog 开销。
    单测或裸脚本若直接调用支付写入函数，需先执行本函数或跑齐 infra/postgres/init 迁移。
    """
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
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'unknown'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS raw_schema_version TEXT NOT NULL DEFAULT 'v1'")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS settlement_currency TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS fx_rate_snapshot NUMERIC(18,8)")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS refunded_amount_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS client_request_id TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS amount_subtotal_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS tax_cents BIGINT NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payable_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paid_cents BIGINT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS source_ip TEXT")
            cur.execute("ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS user_agent TEXT")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_orders_phone_created_at ON payment_orders(phone, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created_at ON payment_orders(user_id, created_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_provider_order ON payment_orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL AND btrim(provider_order_id) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_idempotency_key ON payment_orders(provider, idempotency_key) WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_client_request_id ON payment_orders(provider, client_request_id) WHERE client_request_id IS NOT NULL AND btrim(client_request_id) <> ''"
            )
            conn.commit()
def ensure_payment_webhook_deliveries_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_webhook_deliveries (
                  id BIGSERIAL PRIMARY KEY,
                  event_id TEXT NOT NULL,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  signature_ok BOOLEAN NOT NULL DEFAULT FALSE,
                  payload_hash TEXT NOT NULL,
                  process_result TEXT NOT NULL DEFAULT 'received',
                  error TEXT,
                  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS delivery_count BIGINT NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS trace_id TEXT")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS request_id TEXT")
            cur.execute("ALTER TABLE payment_webhook_deliveries ADD COLUMN IF NOT EXISTS payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_webhook_deliveries_event_received ON payment_webhook_deliveries(event_id, received_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_webhook_deliveries_provider_event_payload ON payment_webhook_deliveries(provider, event_id, payload_hash)"
            )
            conn.commit()
def ensure_payment_reconciliation_queue_schema() -> None:
    """P1：人工对账队列表（与 infra/postgres/init/037_payment_reconciliation_queue.sql 对齐）。"""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_reconciliation_queue (
                  id BIGSERIAL PRIMARY KEY,
                  source TEXT NOT NULL,
                  reason TEXT NOT NULL,
                  out_trade_no TEXT NOT NULL,
                  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_recon_q_reason_created ON payment_reconciliation_queue (reason, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_recon_q_out_trade_no ON payment_reconciliation_queue (out_trade_no)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_recon_q_created ON payment_reconciliation_queue (created_at DESC)"
            )
        conn.commit()
def ensure_payment_refunds_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_refunds (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  refund_id TEXT NOT NULL,
                  refund_status TEXT NOT NULL DEFAULT 'processed',
                  refunded_amount_cents BIGINT NOT NULL DEFAULT 0,
                  currency TEXT NOT NULL DEFAULT 'CNY',
                  refunded_at TIMESTAMPTZ,
                  reason TEXT,
                  trace_id TEXT,
                  request_id TEXT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_provider_refund_id ON payment_refunds(provider, refund_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_refunds_order_created ON payment_refunds(order_event_id, created_at DESC)"
            )
            conn.commit()
def ensure_payment_transactions_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_transactions (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  provider TEXT NOT NULL DEFAULT 'unknown',
                  transaction_type TEXT NOT NULL DEFAULT 'payment',
                  transaction_status TEXT NOT NULL DEFAULT 'unknown',
                  amount_cents BIGINT NOT NULL DEFAULT 0,
                  currency TEXT NOT NULL DEFAULT 'CNY',
                  provider_transaction_id TEXT,
                  idempotency_key TEXT,
                  client_request_id TEXT,
                  occurred_at TIMESTAMPTZ,
                  trace_id TEXT,
                  request_id TEXT,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_created ON payment_transactions(order_event_id, created_at DESC)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_provider_trade_no ON payment_transactions(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL AND btrim(provider_transaction_id) <> ''"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_idempotency_key ON payment_transactions(provider, idempotency_key) WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''"
            )
            conn.commit()
def ensure_payment_order_items_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_order_items (
                  id BIGSERIAL PRIMARY KEY,
                  order_event_id TEXT NOT NULL REFERENCES payment_orders(event_id) ON DELETE CASCADE,
                  line_no INTEGER NOT NULL DEFAULT 1,
                  product_id TEXT,
                  sku TEXT,
                  name TEXT,
                  unit_price_cents BIGINT NOT NULL DEFAULT 0,
                  quantity INTEGER NOT NULL DEFAULT 1,
                  line_subtotal_cents BIGINT NOT NULL DEFAULT 0,
                  discount_cents BIGINT NOT NULL DEFAULT 0,
                  tax_cents BIGINT NOT NULL DEFAULT 0,
                  payable_cents BIGINT NOT NULL DEFAULT 0,
                  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_order_items_line ON payment_order_items(order_event_id, line_no)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_payment_order_items_order ON payment_order_items(order_event_id)"
            )
            conn.commit()
def ensure_subscription_current_state_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_current_state (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  tier TEXT NOT NULL,
                  billing_cycle TEXT,
                  status TEXT NOT NULL DEFAULT 'active',
                  effective_at TIMESTAMPTZ,
                  expires_at TIMESTAMPTZ,
                  source TEXT NOT NULL DEFAULT 'unknown',
                  order_event_id TEXT,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_subscription_current_state_phone ON subscription_current_state(phone)"
            )
            conn.commit()
def ensure_user_payg_minute_grants_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_payg_minute_grants (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  minutes NUMERIC(12, 2) NOT NULL CHECK (minutes > 0),
                  expires_at TIMESTAMPTZ NOT NULL,
                  payment_event_id TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  CONSTRAINT user_payg_minute_grants_payment_event_id_key UNIQUE (payment_event_id)
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_payg_grants_user_expires ON user_payg_minute_grants (user_id, expires_at DESC)"
            )
            cur.execute(
                "ALTER TABLE user_payg_minute_grants ADD COLUMN IF NOT EXISTS minutes_remaining NUMERIC(12, 2)"
            )
            cur.execute(
                """
                UPDATE user_payg_minute_grants
                SET minutes_remaining = minutes
                WHERE minutes_remaining IS NULL
                """
            )
            conn.commit()
def ensure_user_experience_balance_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_experience_balance (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL DEFAULT '',
                  voice_minutes_remaining NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (voice_minutes_remaining >= 0),
                  asr_minutes_remaining NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (asr_minutes_remaining >= 0),
                  text_chars_remaining BIGINT NOT NULL DEFAULT 0 CHECK (text_chars_remaining >= 0),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE user_experience_balance
                ADD COLUMN IF NOT EXISTS asr_minutes_remaining NUMERIC(14,4) NOT NULL DEFAULT 0
                CHECK (asr_minutes_remaining >= 0)
                """
            )
            conn.commit()
def ensure_user_wallet_schema() -> None:
    global _user_wallet_schema_ready
    if _user_wallet_schema_ready:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_wallet_balance (
                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_wallet_topups (
                  payment_event_id TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_checkout_sessions (
                  checkout_id TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_wallet_checkout_user_created ON wallet_checkout_sessions (user_id, created_at DESC)"
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_wallet_ledger (
                  id BIGSERIAL PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  delta_cents BIGINT NOT NULL,
                  balance_after_cents BIGINT NOT NULL,
                  entry_type TEXT NOT NULL,
                  ref_id TEXT,
                  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_wallet_ledger_user_created ON user_wallet_ledger (user_id, created_at DESC)"
            )
            conn.commit()
    _user_wallet_schema_ready = True


def ensure_alipay_page_checkout_schema() -> None:
    """支付宝电脑网站支付待支付会话（与 out_trade_no 对齐，供异步通知验额与履约）。"""
    ensure_user_wallet_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS alipay_page_checkout_sessions (
                  out_trade_no TEXT PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  phone TEXT NOT NULL,
                  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'wallet')),
                  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                  tier TEXT,
                  billing_cycle TEXT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_alipay_page_checkout_user_created "
                "ON alipay_page_checkout_sessions (user_id, created_at DESC)"
            )
            conn.commit()


def ensure_site_traffic_schema() -> None:
    """站点 UV 原始事件表（与 042 迁移一致；表名保留 site_page_views 兼容历史）。"""
    global _site_traffic_schema_ready
    if _site_traffic_schema_ready:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS site_page_views (
                  id BIGSERIAL PRIMARY KEY,
                  visitor_id TEXT NOT NULL,
                  device_visitor_id TEXT,
                  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                  path TEXT NOT NULL DEFAULT '/',
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                "ALTER TABLE site_page_views "
                "ADD COLUMN IF NOT EXISTS device_visitor_id TEXT"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_site_page_views_created ON site_page_views(created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_site_page_views_visitor_created "
                "ON site_page_views(visitor_id, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_site_page_views_sh_day "
                "ON site_page_views(((created_at AT TIME ZONE 'Asia/Shanghai')::date))"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_site_page_views_dedupe_sh_day "
                "ON site_page_views ("
                "(COALESCE(NULLIF(TRIM(device_visitor_id), ''), visitor_id)), "
                "(((created_at AT TIME ZONE 'Asia/Shanghai')::date))"
                ")"
            )
            conn.commit()
    _site_traffic_schema_ready = True


def ensure_app_settings_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
