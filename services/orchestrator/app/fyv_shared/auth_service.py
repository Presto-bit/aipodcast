"""
本地用户认证与会话（PG：user_id 主键；登录标识可为手机号 / 邮箱 / 用户名）。
启用方式：环境变量 FYV_AUTH_ENABLED=1
邀请注册：FYV_ADMIN_INVITE_CODE（默认 fym-admin-2025）

数据文件位于 DATA_DIR：users.json、sessions.json（与音频等 outputs 分离）
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import ssl
import uuid
import threading
import time
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from werkzeug.security import check_password_hash, generate_password_hash
try:
    from redis import Redis
except Exception:  # pragma: no cover - 运行环境缺少 redis 包时自动回退文件会话
    Redis = None  # type: ignore[misc,assignment]
try:
    import psycopg2
    from psycopg2 import IntegrityError as PsycopgIntegrityError
    from psycopg2.extras import RealDictCursor
except Exception:  # pragma: no cover - 运行环境缺少 psycopg2 时自动回退 JSON 认证
    psycopg2 = None  # type: ignore[assignment]
    PsycopgIntegrityError = Exception  # type: ignore[assignment,misc]
    RealDictCursor = None  # type: ignore[assignment]


def jsonify(*args: Any, **kwargs: Any) -> Any:
    """与常见 Web 框架 jsonify 子集兼容：返回 dict（供 guard_feature_request 等构造响应体）。"""
    if args:
        return args[0]
    return kwargs

from .config import DATA_DIR

USERS_FILE = os.path.join(DATA_DIR, "users.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")

_lock = threading.Lock()
_redis_client: Any = None
_redis_checked = False
_redis_migrated_once = False
_pg_checked = False
_pg_enabled = False
_users_phone_nullable: Optional[bool] = None
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", re.IGNORECASE)
EMAIL_VERIFY_TTL_SEC = int(os.environ.get("FYV_AUTH_EMAIL_VERIFY_TTL_SEC", str(48 * 3600)) or 48 * 3600)
PASSWORD_RESET_TTL_SEC = int(os.environ.get("FYV_AUTH_PASSWORD_RESET_TTL_SEC", str(30 * 60)) or 30 * 60)
REGISTER_OTP_TTL_SEC = int(os.environ.get("FYV_AUTH_REGISTER_OTP_TTL_SEC", str(10 * 60)) or 10 * 60)
REGISTER_TICKET_TTL_SEC = int(os.environ.get("FYV_AUTH_REGISTER_TICKET_TTL_SEC", str(10 * 60)) or 10 * 60)
REGISTER_OTP_RESEND_SEC = int(os.environ.get("FYV_AUTH_REGISTER_OTP_RESEND_SEC", str(60)) or 60)
REGISTER_OTP_MAX_ATTEMPTS = int(os.environ.get("FYV_AUTH_REGISTER_OTP_MAX_ATTEMPTS", "5") or 5)
REGISTER_OTP_PURPOSE = "register"

SESSION_TTL_SEC = 7 * 86400
FEATURE_UNLOCK_TTL_SEC = 8 * 3600

VALID_PLANS = frozenset({"free", "basic", "pro", "max"})
VALID_BILLING = frozenset({"monthly", "yearly"})
VALID_ROLES = frozenset({"user", "admin"})
AUTH_LOCK_MAX_FAILED_ATTEMPTS = int(os.environ.get("FYV_AUTH_LOCK_MAX_FAILED_ATTEMPTS", "5") or 5)
AUTH_LOCK_MINUTES = int(os.environ.get("FYV_AUTH_LOCK_MINUTES", "15") or 15)

_WEAK_PASSWORDS = frozenset(
    {
        "123456",
        "12345678",
        "111111",
        "123123",
        "000000",
        "password",
        "password1",
        "qwerty",
        "abc123",
        "admin123",
        "letmein",
        "welcome",
        "monkey",
        "1234567890",
    }
)


def _truthy_strict_password() -> bool:
    raw = (os.environ.get("FYV_AUTH_STRICT_PASSWORD") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _register_password_strength_err(
    password: str,
    email: Optional[str] = None,
    username: Optional[str] = None,
    phone: Optional[str] = None,
) -> Optional[str]:
    """注册密码强度（FYV_AUTH_STRICT_PASSWORD=0 时仅校验长度上限）。"""
    pw = password or ""
    if len(pw) > 128:
        return "密码长度请勿超过 128 位"
    if len(pw) < 6:
        return "密码至少 6 位"
    if not _truthy_strict_password():
        return None
    pl = pw.lower()
    if pl in _WEAK_PASSWORDS:
        return "密码过于简单，请避免常见弱口令（如 123456、password 等）"
    em_local = (email or "").split("@", 1)[0].strip().lower()
    un = (username or "").strip().lower()
    if len(em_local) >= 3 and em_local in pl:
        return "密码请勿包含邮箱 @ 前的用户名部分"
    if len(un) >= 3 and un in pl:
        return "密码请勿包含或等同于用户名"
    ph = (phone or "").strip()
    if len(ph) >= 6 and ph in pw:
        return "密码请勿包含手机号"
    return None


def _coerce_stored_plan(raw: Any) -> str:
    """对外口径：未知/空档位一律视为 free（新注册用户写入 free）。"""
    p = str(raw or "free").strip().lower()
    return p if p in VALID_PLANS else "free"


def _normalize_billing_cycle_for_plan(plan: str, raw_cycle: Any) -> Optional[str]:
    if plan == "free":
        return None
    if raw_cycle is None:
        return None
    c = str(raw_cycle).strip().lower()
    return c if c in VALID_BILLING else None


def _auth_pg_primary() -> bool:
    # 默认开启 PG 主读；缺库或连接失败时自动回退 JSON。
    raw = (os.environ.get("FYV_AUTH_PG_PRIMARY") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _auth_unified_pg_profile() -> bool:
    """FYV_AUTH_UNIFIED_PG=1：推荐生产模式——PG 为单一事实源，关闭双写、JSON 仅只读备份。"""
    raw = (os.environ.get("FYV_AUTH_UNIFIED_PG") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _auth_dual_write() -> bool:
    if _auth_unified_pg_profile():
        return False
    raw = (os.environ.get("FYV_AUTH_DUAL_WRITE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _auth_runtime_ensure_schema() -> bool:
    """
    是否在运行时执行 CREATE/ALTER 兜底（与 infra/postgres/init 重复）。
    生产在已执行 make migrate-db 的前提下可设为 0，避免双入口漂移。
    """
    raw = (os.environ.get("FYV_AUTH_RUNTIME_ENSURE_SCHEMA") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _json_readonly_backup() -> bool:
    if _auth_unified_pg_profile():
        return True
    raw = (os.environ.get("FYV_AUTH_JSON_BACKUP_READONLY") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "")


def _pg_dsn() -> str:
    host = os.environ.get("DB_HOST", "127.0.0.1")
    port = os.environ.get("DB_PORT", "5432")
    db = os.environ.get("DB_NAME", "aipodcast")
    user = os.environ.get("DB_USER", "aipodcast")
    pwd = os.environ.get("DB_PASSWORD", "aipodcast")
    return f"host={host} port={port} dbname={db} user={user} password={pwd} connect_timeout=3"


def _pg_available() -> bool:
    global _pg_checked, _pg_enabled
    if _pg_checked:
        return _pg_enabled
    _pg_checked = True
    if psycopg2 is None:
        _pg_enabled = False
        return False
    try:
        conn = psycopg2.connect(_pg_dsn())
        conn.close()
        _pg_enabled = True
    except Exception:
        _pg_enabled = False
    return _pg_enabled


def _pg_users_phone_column_is_nullable() -> bool:
    """information_schema：phone 是否可为 NULL（未跑 021 迁移时多为 NO，邮箱注册须占位手机号）。"""
    global _users_phone_nullable
    if _users_phone_nullable is not None:
        return _users_phone_nullable
    if not _pg_available() or psycopg2 is None:
        _users_phone_nullable = True
        return True
    try:
        conn = psycopg2.connect(_pg_dsn())
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone'
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if not row:
                _users_phone_nullable = True
            else:
                _users_phone_nullable = str(row[0] or "").upper() == "YES"
        finally:
            conn.close()
    except Exception:
        _users_phone_nullable = True
    return _users_phone_nullable


def _synthetic_placeholder_phone() -> str:
    """占位手机号：不以 1 开头，避免通过 PHONE_RE；极低碰撞。"""
    return "m" + secrets.token_hex(10)


def _ensure_auth_tables_pg() -> None:
    if not _pg_available():
        return
    if not _auth_runtime_ensure_schema():
        return
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
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
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_account_events (
              id BIGSERIAL PRIMARY KEY,
              user_id UUID REFERENCES users(id) ON DELETE SET NULL,
              phone TEXT,
              event_type TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'auth_service',
              actor_phone TEXT,
              reason TEXT,
              trace_id TEXT,
              request_id TEXT,
              meta JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS email_verification_tokens (
              id BIGSERIAL PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              token_hash TEXT NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              consumed_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_email_verification_tokens_hash
            ON email_verification_tokens(token_hash)
            WHERE consumed_at IS NULL
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
              id BIGSERIAL PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              token_hash TEXT NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              consumed_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_password_reset_tokens_hash
            ON password_reset_tokens(token_hash)
            WHERE consumed_at IS NULL
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS email_otp_challenges (
              id BIGSERIAL PRIMARY KEY,
              email TEXT NOT NULL,
              purpose TEXT NOT NULL,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              code_hash TEXT NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              attempt_count INTEGER NOT NULL DEFAULT 0,
              consumed_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CONSTRAINT chk_email_otp_purpose CHECK (purpose = 'register')
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_email_otp_email_purpose_active
            ON email_otp_challenges (lower(email), purpose, id DESC)
            WHERE consumed_at IS NULL
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS registration_tickets (
              id BIGSERIAL PRIMARY KEY,
              token_hash TEXT NOT NULL,
              email TEXT NOT NULL,
              username TEXT NOT NULL,
              invite_code_snapshot TEXT NOT NULL DEFAULT '',
              expires_at TIMESTAMPTZ NOT NULL,
              consumed_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_tickets_hash
            ON registration_tickets (token_hash)
            WHERE consumed_at IS NULL
            """
        )
        conn.commit()
    finally:
        conn.close()


def _truthy_env_email_auto_verify() -> bool:
    return _truthy_env("FYV_AUTH_EMAIL_AUTOVERIFY", "0")


def _truthy_env_email_log_token() -> bool:
    return _truthy_env("FYV_AUTH_EMAIL_LOG_TOKEN", "0")


def register_email_format_ok(email: str) -> bool:
    """与注册发码链路一致的邮箱格式检查（含 @ 与域名后缀）。"""
    em = (email or "").strip()
    return bool(em) and bool(EMAIL_RE.match(em))


def _verify_base_url() -> str:
    return (os.environ.get("FYV_AUTH_VERIFY_BASE_URL") or "").rstrip("/")


def _email_smtp_configured() -> bool:
    return bool((os.environ.get("FYV_SMTP_HOST") or "").strip())


def _smtp_timeout_sec() -> int:
    raw = (os.environ.get("FYV_SMTP_TIMEOUT_SEC") or "").strip()
    if raw:
        try:
            return max(10, min(int(raw), 300))
        except ValueError:
            pass
    return 45


def _smtp_implicit_ssl(port: int) -> bool:
    """465 为 SMTP over TLS；587 必须明文起连再 STARTTLS，切勿对 587 使用 SMTP_SSL。"""
    if port == 465:
        return True
    if port == 587:
        return False
    return _truthy_env("FYV_SMTP_SSL", "0")


def _smtp_ehlo_local_hostname() -> str | None:
    """部分邮服对 EHLO 域名敏感；Docker 缺省 FQDN 异常时可设 FYV_SMTP_EHLO_HOSTNAME（如发信域）。"""
    raw = (os.environ.get("FYV_SMTP_EHLO_HOSTNAME") or "").strip()
    return raw or None


def _smtp_tls_server_name(host: str) -> str | None:
    """STARTTLS 证书校验用的 server_hostname；裸 IP 连接时不强制主机名校验名。"""
    h = (host or "").strip()
    if not h:
        return None
    try:
        ipaddress.ip_address(h)
        return None
    except ValueError:
        return h


def _smtp_tls_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if _truthy_env("FYV_SMTP_TLS_INSECURE", "0"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _smtp_likely_connection_layer_fail(msg: str) -> bool:
    """587 握手/链路问题可改试 465；认证错误等不重试。"""
    low = (msg or "").lower()
    if "535" in low or "authentication failed" in low or ("auth" in low and "invalid credentials" in low):
        return False
    needles = (
        "unexpectedly closed",
        "connection reset",
        "broken pipe",
        "timed out",
        "timeout",
        "connection aborted",
        "wrong version number",
        "ssl:",
        "tls",
        "handshake",
        "starttls",
        "connection refused",
    )
    return any(n in low for n in needles)


def _smtp_send_once(
    mail_from: str,
    to_addrs: list[str],
    msg_as_string: str,
    *,
    host: str,
    port: int,
    user: str,
    password: str,
    timeout: int,
    implicit_ssl: bool,
) -> tuple[bool, str]:
    import smtplib

    lh = _smtp_ehlo_local_hostname()
    ctx = _smtp_tls_context()
    tls_name = _smtp_tls_server_name(host)
    try:
        if implicit_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx, local_hostname=lh) as smtp:
                if _truthy_env("FYV_SMTP_DEBUG", "0"):
                    smtp.set_debuglevel(1)
                smtp.ehlo()
                if user:
                    smtp.login(user, password)
                smtp.sendmail(mail_from, to_addrs, msg_as_string)
        else:
            with smtplib.SMTP(host, port, timeout=timeout, local_hostname=lh) as smtp:
                if _truthy_env("FYV_SMTP_DEBUG", "0"):
                    smtp.set_debuglevel(1)
                smtp.ehlo()
                if port == 587:
                    smtp.starttls(context=ctx, server_hostname=tls_name)
                    smtp.ehlo()
                else:
                    try:
                        smtp.starttls(context=ctx, server_hostname=tls_name)
                        smtp.ehlo()
                    except Exception:
                        pass
                if user:
                    smtp.login(user, password)
                smtp.sendmail(mail_from, to_addrs, msg_as_string)
        return True, "sent"
    except Exception as exc:
        return False, str(exc)


def _smtp_send_raw(mail_from: str, to_addrs: list[str], msg_as_string: str) -> tuple[bool, str]:
    """经 FYV_SMTP_* 投递：显式 TLS 上下文、STARTTLS server_hostname、可选 587→465 自动回退。"""
    host = (os.environ.get("FYV_SMTP_HOST") or "").strip()
    if not host:
        return False, "smtp_not_configured"
    try:
        port = int(os.environ.get("FYV_SMTP_PORT") or "587")
    except ValueError:
        return False, "invalid FYV_SMTP_PORT"
    user = (os.environ.get("FYV_SMTP_USER") or "").strip()
    password = str(os.environ.get("FYV_SMTP_PASSWORD") or "")
    timeout = _smtp_timeout_sec()
    implicit = _smtp_implicit_ssl(port)
    ok, err_detail = _smtp_send_once(
        mail_from,
        to_addrs,
        msg_as_string,
        host=host,
        port=port,
        user=user,
        password=password,
        timeout=timeout,
        implicit_ssl=implicit,
    )
    if ok:
        return True, "sent"
    if (
        (not implicit)
        and port == 587
        and _truthy_env("FYV_SMTP_FALLBACK_465", "1")
        and _smtp_likely_connection_layer_fail(err_detail)
    ):
        ok2, err2 = _smtp_send_once(
            mail_from,
            to_addrs,
            msg_as_string,
            host=host,
            port=465,
            user=user,
            password=password,
            timeout=timeout,
            implicit_ssl=True,
        )
        if ok2:
            return True, "sent"
        return False, f"SMTP 587 失败：{err_detail}；已自动改试 465 SSL：{err2}"
    return False, err_detail


def _hash_email_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def _pg_fetch_auth_user(phone: str) -> Dict[str, Any] | None:
    if not _pg_available():
        return None
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        p_norm = re.sub(r"\D+", "", phone or "")
        cur.execute(
            """
            SELECT
              u.id::text AS user_id,
              u.phone,
              u.email,
              u.username,
              u.email_verified_at,
              u.display_name,
              u.role,
              u.plan,
              u.billing_cycle,
              u.account_status,
              a.password_hash,
              a.status,
              a.failed_attempts,
              a.locked_until
            FROM users u
            LEFT JOIN user_auth_accounts a ON a.user_id = u.id
            WHERE u.phone = %s OR (u.phone_normalized IS NOT NULL AND u.phone_normalized = %s)
            LIMIT 1
            """,
            (phone, p_norm),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _pg_fetch_auth_user_by_user_id(user_id: str) -> Dict[str, Any] | None:
    if not _pg_available():
        return None
    uid = (user_id or "").strip()
    if not uid:
        return None
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
              u.id::text AS user_id,
              u.phone,
              u.email,
              u.username,
              u.email_verified_at,
              u.display_name,
              u.role,
              u.plan,
              u.billing_cycle,
              u.account_status,
              a.password_hash,
              a.status,
              a.failed_attempts,
              a.locked_until
            FROM users u
            LEFT JOIN user_auth_accounts a ON a.user_id = u.id
            WHERE u.id = %s::uuid
            LIMIT 1
            """,
            (uid,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _pg_fetch_auth_user_by_login_identifier(login_id: str) -> Dict[str, Any] | None:
    s = (login_id or "").strip()
    if not s:
        return None
    if not (_auth_pg_primary() and _pg_available()):
        return None
    try:
        uuid.UUID(s)
        row = _pg_fetch_auth_user_by_user_id(s)
        if row:
            return row
    except (ValueError, TypeError, AttributeError):
        pass
    if validate_phone(s):
        return _pg_fetch_auth_user(s)
    if "@" in s:
        _ensure_auth_tables_pg()
        conn = psycopg2.connect(_pg_dsn())
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(
                """
                SELECT
                  u.id::text AS user_id,
                  u.phone,
                  u.email,
                  u.username,
                  u.email_verified_at,
                  u.display_name,
                  u.role,
                  u.plan,
                  u.billing_cycle,
                  u.account_status,
                  a.password_hash,
                  a.status,
                  a.failed_attempts,
                  a.locked_until
                FROM users u
                LEFT JOIN user_auth_accounts a ON a.user_id = u.id
                WHERE lower(btrim(u.email)) = lower(btrim(%s))
                LIMIT 1
                """,
                (s,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
        except Exception:
            return None
        finally:
            conn.close()
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
              u.id::text AS user_id,
              u.phone,
              u.email,
              u.username,
              u.email_verified_at,
              u.display_name,
              u.role,
              u.plan,
              u.billing_cycle,
              u.account_status,
              a.password_hash,
              a.status,
              a.failed_attempts,
              a.locked_until
            FROM users u
            LEFT JOIN user_auth_accounts a ON a.user_id = u.id
            WHERE lower(btrim(u.username)) = lower(btrim(%s))
            LIMIT 1
            """,
            (s,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _login_identifier_is_email_shape(login_id: str) -> bool:
    return "@" in (login_id or "").strip()


def _pg_upsert_user_and_auth(
    *,
    phone: str,
    password_hash: str | None = None,
    display_name: str | None = None,
    role: str | None = None,
    plan: str | None = None,
    billing_cycle: str | None = None,
) -> bool:
    if not _pg_available():
        return False
    _ensure_auth_tables_pg()
    p = (phone or "").strip()
    if not p:
        return False
    dn = (display_name or p).strip() or p
    rl = _normalize_role(role)
    pl = str(plan or "free").strip().lower()
    if pl not in VALID_PLANS:
        pl = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    if bc and bc not in VALID_BILLING:
        bc = None

    p_norm = re.sub(r"\D+", "", p)
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            INSERT INTO users (phone, phone_normalized, display_name, role, plan, billing_cycle, account_status, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'active', NOW())
            ON CONFLICT (phone) DO UPDATE SET
              phone_normalized = EXCLUDED.phone_normalized,
              display_name = EXCLUDED.display_name,
              role = EXCLUDED.role,
              plan = EXCLUDED.plan,
              billing_cycle = EXCLUDED.billing_cycle,
              account_status = CASE WHEN users.account_status = 'deleted' THEN users.account_status ELSE 'active' END,
              updated_at = NOW()
            RETURNING id
            """,
            (p, p_norm, dn, rl, pl, bc),
        )
        row = cur.fetchone()
        uid = str(row["id"]) if row and row.get("id") is not None else ""
        if uid and password_hash:
            cur.execute(
                """
                INSERT INTO user_auth_accounts (user_id, password_hash, status, updated_at)
                VALUES (%s::uuid, %s, 'active', NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  status = 'active',
                  updated_at = NOW()
                """,
                (uid, password_hash),
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def _pg_revive_user_with_credentials(
    *,
    user_id: str,
    phone: str,
    password_hash: str,
    display_name: str,
    role: str,
    plan: str,
    billing_cycle: Optional[str],
) -> bool:
    """将 account_status=deleted 的账号恢复为可用，并更新密码与资料（避免列表中不可见但仍占用手机号）。"""
    if not _pg_available():
        return False
    uid = (user_id or "").strip()
    if not uid:
        return False
    _ensure_auth_tables_pg()
    p = (phone or "").strip()
    if not p:
        return False
    dn = (display_name or p).strip() or p
    rl = _normalize_role(role)
    pl = str(plan or "free").strip().lower()
    if pl not in VALID_PLANS:
        pl = "free"
    bc = (billing_cycle or "").strip().lower() if billing_cycle else None
    if bc and bc not in VALID_BILLING:
        bc = None
    p_norm = re.sub(r"\D+", "", p)
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            UPDATE users
            SET phone = %s,
                phone_normalized = %s,
                display_name = %s,
                role = %s,
                plan = %s,
                billing_cycle = %s,
                account_status = 'active',
                deleted_at = NULL,
                updated_at = NOW()
            WHERE id = %s::uuid
            """,
            (p, p_norm, dn, rl, pl, bc, uid),
        )
        if int(cur.rowcount or 0) < 1:
            return False
        cur.execute(
            """
            INSERT INTO user_auth_accounts (user_id, password_hash, status, updated_at)
            VALUES (%s::uuid, %s, 'active', NOW())
            ON CONFLICT (user_id) DO UPDATE SET
              password_hash = EXCLUDED.password_hash,
              status = 'active',
              updated_at = NOW()
            """,
            (uid, password_hash),
        )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def _pg_delete_user(phone: str) -> bool:
    if not _pg_available():
        return False
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE users
            SET account_status = 'deleted', deleted_at = NOW(), updated_at = NOW()
            WHERE phone = %s
            """,
            (phone,),
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        return False
    finally:
        conn.close()


def _pg_soft_delete_user_by_id(user_id: str) -> bool:
    if not _pg_available() or not user_id:
        return False
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE users
            SET account_status = 'deleted', deleted_at = NOW(), updated_at = NOW()
            WHERE id = %s::uuid
            """,
            (user_id,),
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        return False
    finally:
        conn.close()


def _pg_mark_login_success(user_id: str) -> None:
    if not _pg_available() or not user_id:
        return
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE user_auth_accounts
            SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
            WHERE user_id = %s::uuid
            """,
            (user_id,),
        )
        cur.execute(
            """
            INSERT INTO auth_account_events (user_id, phone, event_type, source, reason, meta)
            SELECT u.id, u.phone, 'login_success', 'auth_service', NULL, '{}'::jsonb
            FROM users u
            WHERE u.id = %s::uuid
            """,
            (user_id,),
        )
        conn.commit()
    finally:
        conn.close()


def _pg_mark_login_failure(user_id: str) -> None:
    if not _pg_available() or not user_id:
        return
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE user_auth_accounts
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                  WHEN failed_attempts + 1 >= %s THEN NOW() + (%s || ' minutes')::interval
                  ELSE locked_until
                END,
                updated_at = NOW()
            WHERE user_id = %s::uuid
            RETURNING failed_attempts, locked_until
            """,
            (AUTH_LOCK_MAX_FAILED_ATTEMPTS, AUTH_LOCK_MINUTES, user_id),
        )
        row = cur.fetchone()
        failed_attempts = int((row or [0, None])[0] or 0)
        locked_until = (row or [0, None])[1]
        evt_type = "login_locked" if locked_until else "login_failed"
        cur.execute(
            """
            INSERT INTO auth_account_events (user_id, phone, event_type, source, reason, meta)
            SELECT u.id, u.phone, %s, 'auth_service', %s, %s::jsonb
            FROM users u
            WHERE u.id = %s::uuid
            """,
            (
                evt_type,
                "too_many_failures" if evt_type == "login_locked" else "bad_password",
                json.dumps({"failed_attempts": failed_attempts}, ensure_ascii=False),
                user_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _pg_list_users() -> list[Dict[str, Any]]:
    if not _pg_available():
        return []
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
              u.id::text AS user_id,
              u.phone,
              u.email,
              u.username,
              u.plan,
              u.billing_cycle,
              u.role,
              u.account_status,
              EXTRACT(EPOCH FROM u.created_at)::bigint AS created_at,
              (a.password_hash IS NOT NULL) AS has_password,
              (u.email_verified_at IS NOT NULL) AS email_verified
            FROM users u
            LEFT JOIN user_auth_accounts a ON a.user_id = u.id
            WHERE u.account_status <> 'deleted'
            ORDER BY u.created_at DESC
            """
        )
        return [dict(x) for x in cur.fetchall()]
    except Exception:
        return []
    finally:
        conn.close()


def is_auth_enabled() -> bool:
    v = (os.environ.get("FYV_AUTH_ENABLED") or "0").strip().lower()
    return v not in ("0", "false", "no", "off", "")


def get_admin_invite_code() -> str:
    return (os.environ.get("FYV_ADMIN_INVITE_CODE") or "fym-admin-2025").strip()


def is_register_invite_required() -> bool:
    """FYV_REQUIRE_INVITE=1/true/on/yes 时注册须携带与 FYV_ADMIN_INVITE_CODE 一致的邀请码；默认不要求。"""
    v = (os.environ.get("FYV_REQUIRE_INVITE") or "0").strip().lower()
    return v in ("1", "true", "yes", "on")


def _truthy_env(name: str, default: str = "0") -> bool:
    v = (os.environ.get(name) or default).strip().lower()
    return v not in ("0", "false", "no", "off", "")


def _normalize_role(role: Any) -> str:
    r = str(role or "user").strip().lower()
    return r if r in VALID_ROLES else "user"


def _ops_admin_phone_set() -> set[str]:
    raw = (os.environ.get("FYV_OPS_ADMIN_PHONES") or "").strip()
    if not raw:
        return set()
    return {p.strip() for p in raw.split(",") if p.strip()}


def _ops_admin_user_ids_set() -> set[str]:
    raw = (os.environ.get("FYV_OPS_ADMIN_USER_IDS") or "").strip()
    if not raw:
        return set()
    out: set[str] = set()
    for p in raw.split(","):
        s = p.strip()
        if not s:
            continue
        try:
            out.add(str(uuid.UUID(s)))
        except Exception:
            continue
    return out


def _resolve_auth_row_for_principal(ref: str) -> Optional[Dict[str, Any]]:
    r = (ref or "").strip()
    if not r:
        return None
    if not (_auth_pg_primary() and _pg_available()):
        return None
    row = _pg_fetch_auth_user_by_login_identifier(r)
    if not row and validate_phone(r):
        row = _pg_fetch_auth_user(r)
    if not row:
        row = _pg_fetch_auth_user_by_user_id(r)
    return row if isinstance(row, dict) else None


def _pg_update_user_fields_by_user_id(
    user_id: str,
    *,
    plan: Optional[str] = None,
    billing_cycle: Optional[str] = None,
    display_name: Optional[str] = None,
    username: Optional[str] = None,
    role: Optional[str] = None,
) -> bool:
    if not _pg_available() or not user_id:
        return False
    parts: list[str] = []
    args: list[Any] = []
    if plan is not None:
        pl = str(plan or "free").strip().lower()
        if pl not in VALID_PLANS:
            pl = "free"
        parts.append("plan = %s")
        args.append(pl)
    if billing_cycle is not None:
        parts.append("billing_cycle = %s")
        args.append(billing_cycle)
    if display_name is not None:
        parts.append("display_name = %s")
        args.append(display_name)
    if username is not None:
        parts.append("username = %s")
        args.append(username)
    if role is not None:
        rl = _normalize_role(role)
        parts.append("role = %s")
        args.append(rl)
    if not parts:
        return True
    parts.append("updated_at = NOW()")
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE users SET {', '.join(parts)} WHERE id = %s::uuid",
            (*args, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    except PsycopgIntegrityError:
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    finally:
        conn.close()


def _pg_username_taken_by_other(user_id: str, username: str) -> bool:
    uid = (user_id or "").strip()
    un = (username or "").strip()
    if not uid or not un:
        return False
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT 1 FROM users
            WHERE lower(btrim(username)) = lower(btrim(%s))
              AND id <> %s::uuid
            LIMIT 1
            """,
            (un, uid),
        )
        return cur.fetchone() is not None
    except Exception:
        return True
    finally:
        conn.close()


def _load_json(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_users() -> Dict[str, Any]:
    with _lock:
        raw = _load_json(USERS_FILE, {})
        return raw if isinstance(raw, dict) else {}


def _save_users(users: Dict[str, Any]) -> None:
    _save_json(USERS_FILE, users)


def _load_sessions() -> Dict[str, Any]:
    if _session_backend() == "redis":
        _migrate_sessions_file_to_redis_once()
        return _load_sessions_from_redis()
    with _lock:
        raw = _load_json(SESSIONS_FILE, {})
        return raw if isinstance(raw, dict) else {}


def _save_sessions(sessions: Dict[str, Any]) -> None:
    if _session_backend() == "redis":
        _save_sessions_to_redis(sessions)
        return
    _save_json(SESSIONS_FILE, sessions)


def _now() -> float:
    return time.time()


def _session_backend() -> str:
    raw = (os.environ.get("FYV_AUTH_SESSION_BACKEND") or "redis").strip().lower()
    if raw not in ("redis", "file"):
        return "redis"
    if raw == "redis" and _get_redis_client() is None:
        return "file"
    return raw


def _redis_key(token: str) -> str:
    return f"fym:auth:session:{token}"


def _get_redis_client() -> Redis | None:
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    if Redis is None:
        return None
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        cli = Redis.from_url(url, decode_responses=True)
        cli.ping()
        _redis_client = cli
        return _redis_client
    except Exception:
        _redis_client = None
        return None


def _session_ttl_seconds(sess: Dict[str, Any]) -> int:
    exp = float(sess.get("expires") or 0)
    ttl = int(exp - _now())
    return max(1, ttl)


def _load_sessions_from_redis() -> Dict[str, Any]:
    cli = _get_redis_client()
    if cli is None:
        return {}
    out: Dict[str, Any] = {}
    try:
        for key in cli.scan_iter(match="fym:auth:session:*", count=200):
            raw = cli.get(str(key))
            if not raw:
                continue
            try:
                sess = json.loads(raw)
            except Exception:
                continue
            if not isinstance(sess, dict):
                continue
            token = str(key).split("fym:auth:session:", 1)[-1]
            if not token:
                continue
            if float(sess.get("expires") or 0) < _now():
                cli.delete(str(key))
                continue
            out[token] = sess
    except Exception:
        return {}
    return out


def _save_sessions_to_redis(sessions: Dict[str, Any]) -> None:
    cli = _get_redis_client()
    if cli is None:
        _save_json(SESSIONS_FILE, sessions)
        return
    try:
        existing = set(cli.scan_iter(match="fym:auth:session:*", count=200))
        keep = set()
        pipe = cli.pipeline()
        for token, sess in sessions.items():
            if not isinstance(sess, dict):
                continue
            key = _redis_key(str(token))
            keep.add(key)
            pipe.set(key, json.dumps(sess, ensure_ascii=False), ex=_session_ttl_seconds(sess))
        for key in existing - keep:
            pipe.delete(str(key))
        pipe.execute()
    except Exception:
        _save_json(SESSIONS_FILE, sessions)


def _migrate_sessions_file_to_redis_once() -> None:
    global _redis_migrated_once
    if _redis_migrated_once:
        return
    _redis_migrated_once = True
    cli = _get_redis_client()
    if cli is None:
        return
    try:
        has_any = any(cli.scan_iter(match="fym:auth:session:*", count=1))
    except Exception:
        return
    if has_any:
        return
    raw = _load_json(SESSIONS_FILE, {})
    if not isinstance(raw, dict) or not raw:
        return
    try:
        pipe = cli.pipeline()
        for token, sess in raw.items():
            if not isinstance(sess, dict):
                continue
            if float(sess.get("expires") or 0) < _now():
                continue
            pipe.set(_redis_key(str(token)), json.dumps(sess, ensure_ascii=False), ex=_session_ttl_seconds(sess))
        pipe.execute()
    except Exception:
        return


def _purge_expired_sessions(sessions: Dict[str, Any]) -> None:
    t = _now()
    dead = [k for k, s in sessions.items() if isinstance(s, dict) and float(s.get("expires") or 0) < t]
    for k in dead:
        del sessions[k]


def session_effective_user_id(sess: Dict[str, Any]) -> str:
    uid = str(sess.get("user_id") or "").strip()
    if uid:
        return uid
    if _auth_pg_primary() and _pg_available():
        for key in ("phone", "email", "username"):
            v = str(sess.get(key) or "").strip()
            if not v:
                continue
            row = _pg_fetch_auth_user_by_login_identifier(v)
            if isinstance(row, dict) and row.get("user_id"):
                return str(row["user_id"])
        return ""
    return str(sess.get("phone") or "").strip()


def _pg_format_integrity_err_user_insert(exc: BaseException) -> str:
    """唯一约束 / CHECK / NOT NULL → 可读说明；diag 或约束名缺失时从 pgerror 推断。"""
    diag = getattr(exc, "diag", None)
    cname = ""
    if diag is not None:
        cname = str(getattr(diag, "constraint_name", None) or "").strip()
    cn = cname.lower()
    pgerr = ""
    if diag is not None:
        pgerr = str(getattr(diag, "message_primary", None) or "").strip()
    if not pgerr:
        pgerr = str(getattr(exc, "pgerror", None) or str(exc) or "")
    pe = pgerr.lower()
    if cname:
        if "email" in cn or "ux_users_email" in cn:
            return "该邮箱已注册"
        if "username" in cn or "ux_users_username" in cn:
            return "该用户名已被占用"
        if "not_blank" in cn and "phone" in cn:
            return (
                "注册失败：数据库仍要求手机号非空，请执行迁移 infra/postgres/init/021_user_login_identifiers.sql "
                "（或 make migrate-db）后重试。"
            )
        if "phone" in cn or "ux_users_phone" in cn:
            return "该手机号已被占用"
        return f"注册失败：与已有数据冲突（{cname}）"
    if "ux_users_email" in pe or '(email)=' in pe or '("email")' in pe:
        return "该邮箱已注册"
    if "ux_users_username" in pe or '(username)=' in pe or '("username")' in pe:
        return "该用户名已被占用"
    if "users_phone_not_blank" in pe or ("violates not-null constraint" in pe and "phone" in pe):
        return (
            "注册失败：数据库仍要求手机号非空，请执行迁移 infra/postgres/init/021_user_login_identifiers.sql "
            "（或 make migrate-db）后重试。"
        )
    if "ux_users_phone" in pe or ("duplicate key" in pe and "phone" in pe):
        return "该手机号已被占用"
    if "violates check constraint" in pe and "plan" in pe:
        return "注册失败：users.plan 与数据库 CHECK 不一致，请运行最新迁移或联系管理员。"
    if pe:
        return f"注册失败：数据库拒绝写入（{pgerr.strip()[:200]}）"
    return "注册失败：数据约束冲突，请稍后再试或更换邮箱/用户名"


def _pg_insert_user_with_credentials_on_cur(
    cur: Any,
    *,
    phone: Optional[str],
    email: Optional[str],
    username: Optional[str],
    password_hash: str,
    display_name: str,
    email_verified_at: Optional[datetime],
) -> tuple[Optional[str], Optional[str]]:
    """在当前事务的 cursor 上插入 users + user_auth_accounts，不 commit。返回 (user_id, err)。"""
    p = (phone or "").strip() or None
    if p is None and not _pg_users_phone_column_is_nullable():
        p = _synthetic_placeholder_phone()
    em = (email or "").strip().lower() or None
    un = (username or "").strip() or None
    dn = (display_name or "").strip() or (un or em or p or "User")
    try:
        cur.execute(
            """
            INSERT INTO users (phone, email, username, display_name, role, plan, billing_cycle, account_status, email_verified_at, updated_at)
            VALUES (%s, %s, %s, %s, 'user', 'free', NULL, 'active', %s, NOW())
            RETURNING id::text AS uid
            """,
            (p, em, un, dn, email_verified_at),
        )
        row = cur.fetchone()
        uid = ""
        if row:
            if isinstance(row, dict):
                uid = str(row.get("uid") or "").strip()
            else:
                uid = str(row[0] or "").strip()
        if not uid:
            return None, "注册失败"
        cur.execute(
            """
            INSERT INTO user_auth_accounts (user_id, password_hash, status, updated_at)
            VALUES (%s::uuid, %s, 'active', NOW())
            """,
            (uid, password_hash),
        )
        return uid, None
    except PsycopgIntegrityError as exc:
        return None, _pg_format_integrity_err_user_insert(exc)


def _pg_insert_user_with_credentials(
    *,
    phone: Optional[str],
    email: Optional[str],
    username: Optional[str],
    password_hash: str,
    display_name: str,
    email_verified_at: Optional[datetime],
) -> tuple[Optional[str], Optional[str]]:
    """独立连接事务内注册（如手机号+邮箱注册）；返回 (user_id, err)。"""
    if not _pg_available():
        return None, "数据库不可用"
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        uid, err = _pg_insert_user_with_credentials_on_cur(
            cur,
            phone=phone,
            email=email,
            username=username,
            password_hash=password_hash,
            display_name=display_name,
            email_verified_at=email_verified_at,
        )
        if err:
            conn.rollback()
            return None, err
        conn.commit()
        return uid, None
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, "注册失败（数据库写入失败）"
    finally:
        conn.close()


def _pg_store_email_verification_token(user_id: str) -> Optional[str]:
    raw = secrets.token_urlsafe(32)
    th = _hash_email_token(raw)
    if not _pg_available():
        return raw
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        exp = datetime.now(timezone.utc) + timedelta(seconds=EMAIL_VERIFY_TTL_SEC)
        cur.execute(
            """
            INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
            VALUES (%s::uuid, %s, %s)
            """,
            (user_id, th, exp),
        )
        conn.commit()
        return raw
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        conn.close()


def _send_verification_email(to_addr: str, verify_link: str) -> tuple[bool, str]:
    user = (os.environ.get("FYV_SMTP_USER") or "").strip()
    mail_from = (os.environ.get("FYV_SMTP_FROM") or user or "noreply@localhost").strip()
    try:
        from email.mime.text import MIMEText

        msg = MIMEText(f"请点击链接完成邮箱验证（{EMAIL_VERIFY_TTL_SEC // 3600} 小时内有效）：\n{verify_link}\n", "plain", "utf-8")
        msg["Subject"] = str(os.environ.get("FYV_SMTP_VERIFY_SUBJECT") or "完成邮箱验证")
        msg["From"] = mail_from
        msg["To"] = to_addr
        return _smtp_send_raw(mail_from, [to_addr], msg.as_string())
    except Exception as exc:
        return False, str(exc)


def _send_password_reset_email(to_addr: str, reset_link: str) -> tuple[bool, str]:
    user = (os.environ.get("FYV_SMTP_USER") or "").strip()
    mail_from = (os.environ.get("FYV_SMTP_FROM") or user or "noreply@localhost").strip()
    minutes = max(1, PASSWORD_RESET_TTL_SEC // 60)
    try:
        from email.mime.text import MIMEText

        msg = MIMEText(
            f"请点击链接重置密码（{minutes} 分钟内有效）：\n{reset_link}\n",
            "plain",
            "utf-8",
        )
        msg["Subject"] = str(os.environ.get("FYV_SMTP_RESET_SUBJECT") or "重置密码")
        msg["From"] = mail_from
        msg["To"] = to_addr
        return _smtp_send_raw(mail_from, [to_addr], msg.as_string())
    except Exception as exc:
        return False, str(exc)


def verify_email_token(raw_token: str) -> Tuple[bool, str]:
    t = (raw_token or "").strip()
    if not t:
        return False, "无效链接"
    if not _pg_available():
        return False, "数据库不可用"
    th = _hash_email_token(t)
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, user_id::text AS user_id
            FROM email_verification_tokens
            WHERE token_hash = %s AND consumed_at IS NULL AND expires_at > NOW()
            LIMIT 1
            """,
            (th,),
        )
        row = cur.fetchone()
        if not row:
            return False, "链接已失效或已使用"
        tid = int(row["id"])
        uid = str(row["user_id"])
        cur.execute(
            """
            UPDATE email_verification_tokens SET consumed_at = NOW() WHERE id = %s
            """,
            (tid,),
        )
        cur.execute(
            """
            UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
            WHERE id = %s::uuid
            """,
            (uid,),
        )
        conn.commit()
        return True, uid
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, "验证失败"
    finally:
        conn.close()


def _pg_fetch_user_for_password_reset(email: str) -> Dict[str, Any] | None:
    em = (email or "").strip().lower()
    if not em or not _pg_available():
        return None
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
              u.id::text AS user_id,
              u.phone,
              u.email,
              u.username,
              u.account_status
            FROM users u
            INNER JOIN user_auth_accounts a ON a.user_id = u.id AND a.password_hash IS NOT NULL
            WHERE lower(btrim(u.email)) = lower(btrim(%s))
              AND u.email_verified_at IS NOT NULL
            LIMIT 1
            """,
            (em,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _pg_store_password_reset_token(user_id: str) -> Optional[str]:
    raw = secrets.token_urlsafe(32)
    th = _hash_email_token(raw)
    if not _pg_available():
        return None
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE password_reset_tokens
            SET consumed_at = NOW()
            WHERE user_id = %s::uuid AND consumed_at IS NULL
            """,
            (user_id,),
        )
        exp = datetime.now(timezone.utc) + timedelta(seconds=PASSWORD_RESET_TTL_SEC)
        cur.execute(
            """
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES (%s::uuid, %s, %s)
            """,
            (user_id, th, exp),
        )
        conn.commit()
        return raw
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        conn.close()


def request_password_reset_by_email(email: str) -> None:
    """若存在已验证邮箱账号则发重置邮件；否则静默。始终由上层返回统一提示。"""
    em = (email or "").strip().lower()
    if not em or not EMAIL_RE.match(em):
        return
    if not (_auth_pg_primary() and _pg_available()):
        return
    row = _pg_fetch_user_for_password_reset(em)
    if not isinstance(row, dict):
        return
    account_status = str(row.get("account_status") or "active").strip().lower()
    if account_status in ("disabled", "deleted"):
        return
    uid = str(row.get("user_id") or "").strip()
    if not uid:
        return
    raw_tok = _pg_store_password_reset_token(uid)
    if not raw_tok:
        return
    base = _verify_base_url()
    link = f"{base}/reset-password?token={raw_tok}" if base else ""
    to_addr = str(row.get("email") or em).strip()
    if _email_smtp_configured():
        body_link = link if base else f"(请配置 FYV_AUTH_VERIFY_BASE_URL) token={raw_tok}"
        _send_password_reset_email(to_addr, body_link)
    if _truthy_env_email_log_token() and raw_tok:
        print(f"[auth] password reset token for {em}: {link or raw_tok}")


def _invalidate_sessions_for_user(
    user_id: str,
    *,
    phone: str = "",
    email: str = "",
    username: str = "",
) -> None:
    uid = (user_id or "").strip()
    ph = (phone or "").strip()
    em = (email or "").strip().lower()
    un = (username or "").strip()
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                for key in cli.scan_iter(match="fym:auth:session:*", count=200):
                    try:
                        raw = cli.get(key)
                        if not raw:
                            continue
                        s = json.loads(raw)
                        if not isinstance(s, dict):
                            continue
                        match = bool(uid and str(s.get("user_id") or "").strip() == uid)
                        if not match and ph and str(s.get("phone") or "").strip() == ph:
                            match = True
                        if not match and em and str(s.get("email") or "").strip().lower() == em:
                            match = True
                        if not match and un and str(s.get("username") or "").strip() == un:
                            match = True
                        if match:
                            cli.delete(key)
                    except Exception:
                        pass
                return
            except Exception:
                pass
    sessions = _load_sessions()
    _purge_expired_sessions(sessions)
    to_del: list[str] = []
    for token, s in list(sessions.items()):
        if not isinstance(s, dict):
            continue
        match = bool(uid and str(s.get("user_id") or "").strip() == uid)
        if not match and ph and str(s.get("phone") or "").strip() == ph:
            match = True
        if not match and em and str(s.get("email") or "").strip().lower() == em:
            match = True
        if not match and un and str(s.get("username") or "").strip() == un:
            match = True
        if match:
            to_del.append(str(token))
    if to_del:
        for t in to_del:
            sessions.pop(t, None)
        _save_sessions(sessions)


def reset_password_with_token(raw_token: str, new_password: str) -> Tuple[bool, str]:
    if len((new_password or "")) < 6:
        return False, "密码至少 6 位"
    t = (raw_token or "").strip()
    if not t:
        return False, "无效链接"
    if not _pg_available():
        return False, "数据库不可用"
    th = _hash_email_token(t)
    _ensure_auth_tables_pg()
    uid = ""
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, user_id::text AS user_id
            FROM password_reset_tokens
            WHERE token_hash = %s AND consumed_at IS NULL AND expires_at > NOW()
            LIMIT 1
            """,
            (th,),
        )
        row = cur.fetchone()
        if not row:
            return False, "链接已失效或已使用"
        tid = int(row["id"])
        uid = str(row["user_id"])
        cur.execute(
            "UPDATE password_reset_tokens SET consumed_at = NOW() WHERE id = %s",
            (tid,),
        )
        pw_hash = generate_password_hash(new_password)
        cur.execute(
            """
            UPDATE user_auth_accounts
            SET password_hash = %s, updated_at = NOW(), failed_attempts = 0, locked_until = NULL
            WHERE user_id = %s::uuid
            """,
            (pw_hash, uid),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False, "重置失败"
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, "重置失败"
    finally:
        conn.close()
    urow = _pg_fetch_auth_user_by_user_id(uid) if uid else None
    if isinstance(urow, dict):
        _invalidate_sessions_for_user(
            uid,
            phone=str(urow.get("phone") or ""),
            email=str(urow.get("email") or ""),
            username=str(urow.get("username") or ""),
        )
    elif uid:
        _invalidate_sessions_for_user(uid)
    return True, ""


def _send_register_otp_email(to_addr: str, code: str) -> tuple[bool, str]:
    user = (os.environ.get("FYV_SMTP_USER") or "").strip()
    mail_from = (os.environ.get("FYV_SMTP_FROM") or user or "noreply@localhost").strip()
    minutes = max(1, REGISTER_OTP_TTL_SEC // 60)
    try:
        from email.mime.text import MIMEText

        msg = MIMEText(
            f"您的注册验证码为：{code}\n{minutes} 分钟内有效，请勿泄露给他人。\n",
            "plain",
            "utf-8",
        )
        msg["Subject"] = str(os.environ.get("FYV_SMTP_REGISTER_OTP_SUBJECT") or "注册验证码")
        msg["From"] = mail_from
        msg["To"] = to_addr
        return _smtp_send_raw(mail_from, [to_addr], msg.as_string())
    except Exception as exc:
        return False, str(exc)


def _pg_register_slots_available(email: str, username: str) -> Tuple[bool, str]:
    em = (email or "").strip().lower()
    un = (username or "").strip()
    if not em or not EMAIL_RE.match(em):
        return False, "邮箱格式无效"
    if not un or not USERNAME_RE.match(un):
        return False, "用户名为 3–32 位字母数字下划线"
    if not (_auth_pg_primary() and _pg_available()):
        return False, "当前环境需 PostgreSQL 才能注册"
    if isinstance(_pg_fetch_auth_user_by_login_identifier(em), dict):
        return False, "该邮箱已注册"
    if isinstance(_pg_fetch_auth_user_by_login_identifier(un), dict):
        return False, "该用户名已被占用"
    return True, ""


def _normalize_register_otp_code(raw: str) -> str:
    """仅保留数字，便于粘贴「123 456」「123-456」等格式。"""
    s = re.sub(r"\D+", "", (raw or "").strip())
    if len(s) == 6 and s.isdigit():
        return s
    return ""


def _pg_register_otp_resend_block_remaining_sec(email: str) -> int:
    em = (email or "").strip().lower()
    if not em or not _pg_available():
        return 0
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_sec
            FROM email_otp_challenges
            WHERE lower(email) = lower(%s) AND purpose = %s
            ORDER BY id DESC
            LIMIT 1
            """,
            (em, REGISTER_OTP_PURPOSE),
        )
        row = cur.fetchone()
        if not row or row[0] is None:
            return 0
        age = int(row[0])
        wait = REGISTER_OTP_RESEND_SEC - age
        return max(0, wait)
    except Exception:
        return 0
    finally:
        conn.close()


def register_send_otp(email: str, username: str, invite_code: str) -> Tuple[bool, str, Dict[str, Any]]:
    """邮箱验证码注册：OTP 落库后**同步**发 SMTP（成功才返回 ok），避免前端已显示「已发送」却未投递。"""
    meta: Dict[str, Any] = {}
    if not is_auth_enabled():
        return False, "认证未启用", meta
    em = (email or "").strip().lower()
    un = (username or "").strip()
    invite = (invite_code or "").strip()
    if not register_email_format_ok(em):
        return False, "邮箱格式不正确，请填写含 @ 与域名后缀的有效地址（如 name@example.com）", meta
    if is_register_invite_required() and invite != get_admin_invite_code():
        return False, "邀请码无效", meta
    ok_slot, err_slot = _pg_register_slots_available(em, un)
    if not ok_slot:
        return False, err_slot, meta
    wait = _pg_register_otp_resend_block_remaining_sec(em)
    if wait > 0:
        return False, f"发送过于频繁，请 {wait} 秒后再试", meta
    code = f"{secrets.randbelow(1000000):06d}"
    code_hash = _hash_email_token(code)
    md = json.dumps({"username": un, "invite_code": invite}, ensure_ascii=False)
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE email_otp_challenges
            SET consumed_at = NOW()
            WHERE lower(email) = lower(%s) AND purpose = %s AND consumed_at IS NULL
            """,
            (em, REGISTER_OTP_PURPOSE),
        )
        exp = datetime.now(timezone.utc) + timedelta(seconds=REGISTER_OTP_TTL_SEC)
        cur.execute(
            """
            INSERT INTO email_otp_challenges (email, purpose, metadata, code_hash, expires_at)
            VALUES (%s, %s, %s::jsonb, %s, %s)
            """,
            (em, REGISTER_OTP_PURPOSE, md, code_hash, exp),
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, "发送失败，请稍后重试", meta
    finally:
        conn.close()
    if _truthy_env_email_log_token():
        print(f"[auth] register OTP for {em}: {code}")
        meta["verification_email_sent"] = False
        meta["dev_otp_logged"] = True
        meta["smtp_dispatch"] = "log_only"
        return True, "", meta
    if not _email_smtp_configured():
        _pg_consume_latest_active_register_otp(em)
        return False, (
            "验证码邮件发送失败或未配置邮件服务（本地调试可在编排器环境设 FYV_AUTH_EMAIL_LOG_TOKEN=1，"
            "验证码会打印到编排器日志；或配置 FYV_SMTP_HOST 等发信参数）"
        ), meta
    ok_m, smtp_detail = _send_register_otp_email(em, code)
    if not ok_m:
        _pg_consume_latest_active_register_otp(em)
        if smtp_detail and smtp_detail != "smtp_not_configured":
            tail = (smtp_detail or "").strip().replace("\n", " ")
            if len(tail) > 240:
                tail = tail[:237] + "..."
            return False, f"验证码邮件发送失败（SMTP）：{tail}", meta
        return False, (
            "验证码邮件发送失败或未配置邮件服务（本地调试可在编排器环境设 FYV_AUTH_EMAIL_LOG_TOKEN=1，"
            "验证码会打印到编排器日志；或配置 FYV_SMTP_HOST 等发信参数）"
        ), meta
    meta["verification_email_sent"] = True
    meta["dev_otp_logged"] = False
    meta["smtp_dispatch"] = "sync"
    return True, "", meta


def _pg_consume_latest_active_register_otp(email: str) -> None:
    em = (email or "").strip().lower()
    if not em or not _pg_available():
        return
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE email_otp_challenges
            SET consumed_at = NOW()
            WHERE id = (
              SELECT id FROM email_otp_challenges
              WHERE lower(email) = lower(%s) AND purpose = %s AND consumed_at IS NULL
              ORDER BY id DESC
              LIMIT 1
            )
            """,
            (em, REGISTER_OTP_PURPOSE),
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def register_verify_otp(email: str, code_raw: str) -> Tuple[Optional[str], str]:
    """校验注册 OTP，成功则返回 (registration_ticket, '')。"""
    em = (email or "").strip().lower()
    code = _normalize_register_otp_code(code_raw)
    if not em or not EMAIL_RE.match(em):
        return None, "邮箱格式无效"
    if not code:
        return None, "请输入 6 位数字验证码"
    if not _pg_available():
        return None, "数据库不可用"
    code_hash = _hash_email_token(code)
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    try:
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, metadata, attempt_count, expires_at, code_hash
            FROM email_otp_challenges
            WHERE lower(email) = lower(%s)
              AND purpose = %s
              AND consumed_at IS NULL
              AND expires_at > NOW()
            ORDER BY id DESC
            LIMIT 1
            FOR UPDATE
            """,
            (em, REGISTER_OTP_PURPOSE),
        )
        row = cur.fetchone()
        if not row:
            try:
                conn.rollback()
            except Exception:
                pass
            return None, "验证码无效或已过期"
        oid = int(row["id"])
        attempts = int(row["attempt_count"] or 0)
        if attempts >= REGISTER_OTP_MAX_ATTEMPTS:
            cur.execute(
                "UPDATE email_otp_challenges SET consumed_at = NOW() WHERE id = %s",
                (oid,),
            )
            conn.commit()
            return None, "验证失败次数过多，请重新获取验证码"
        md_raw = row.get("metadata")
        if isinstance(md_raw, str):
            try:
                md = json.loads(md_raw)
            except Exception:
                md = {}
        elif isinstance(md_raw, dict):
            md = dict(md_raw)
        else:
            md = {}
        un = str(md.get("username") or "").strip()
        invite_snap = str(md.get("invite_code") or "").strip()
        if not un or not USERNAME_RE.match(un):
            cur.execute(
                "UPDATE email_otp_challenges SET consumed_at = NOW() WHERE id = %s",
                (oid,),
            )
            conn.commit()
            return None, "注册数据无效，请重新获取验证码"
        exp_at = row["expires_at"]
        if isinstance(exp_at, datetime):
            exp_aware = exp_at if exp_at.tzinfo else exp_at.replace(tzinfo=timezone.utc)
            if exp_aware <= datetime.now(timezone.utc):
                cur.execute(
                    "UPDATE email_otp_challenges SET consumed_at = NOW() WHERE id = %s",
                    (oid,),
                )
                conn.commit()
                return None, "验证码已过期"
        if not secrets.compare_digest(str(row.get("code_hash") or ""), code_hash):
            cur.execute(
                "UPDATE email_otp_challenges SET attempt_count = attempt_count + 1 WHERE id = %s",
                (oid,),
            )
            conn.commit()
            return None, "验证码错误"
        raw_tik = secrets.token_urlsafe(32)
        th = _hash_email_token(raw_tik)
        t_exp = datetime.now(timezone.utc) + timedelta(seconds=REGISTER_TICKET_TTL_SEC)
        cur.execute(
            """
            INSERT INTO registration_tickets (token_hash, email, username, invite_code_snapshot, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (th, em, un, invite_snap, t_exp),
        )
        cur.execute(
            "UPDATE email_otp_challenges SET consumed_at = NOW() WHERE id = %s",
            (oid,),
        )
        conn.commit()
        return raw_tik, ""
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, "验证失败"
    finally:
        try:
            conn.autocommit = True
        except Exception:
            pass
        conn.close()


def register_complete_with_ticket(ticket_raw: str, password: str) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """凭 registration_ticket 创建账号（邮箱已验证）。返回 (session_token, err, meta)。"""
    meta: Dict[str, Any] = {}
    if not is_auth_enabled():
        return None, "认证未启用（服务端 FYV_AUTH_ENABLED）", meta
    if len((password or "")) < 6:
        return None, "密码至少 6 位", meta
    t = (ticket_raw or "").strip()
    if not t:
        return None, "注册凭证无效", meta
    if not _pg_available():
        return None, "数据库不可用", meta
    th = _hash_email_token(t)
    _ensure_auth_tables_pg()
    conn = psycopg2.connect(_pg_dsn())
    uid = ""
    try:
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, email, username, invite_code_snapshot, expires_at
            FROM registration_tickets
            WHERE token_hash = %s AND consumed_at IS NULL AND expires_at > NOW()
            LIMIT 1
            FOR UPDATE
            """,
            (th,),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            cur.execute(
                """
                SELECT consumed_at, expires_at
                FROM registration_tickets
                WHERE token_hash = %s
                LIMIT 1
                """,
                (th,),
            )
            r2 = cur.fetchone()
            if r2 and r2.get("consumed_at"):
                return None, (
                    "该注册凭证已使用（账号可能已创建）。请尝试直接登录；"
                    "若仍需新账号，请重新获取邮箱验证码。"
                ), meta
            exp_raw = (r2 or {}).get("expires_at")
            if isinstance(exp_raw, datetime):
                exp_aware = exp_raw if exp_raw.tzinfo else exp_raw.replace(tzinfo=timezone.utc)
                if exp_aware <= datetime.now(timezone.utc):
                    return None, "注册凭证已过期，请返回重新获取邮箱验证码。", meta
            return None, "注册凭证无效，请重新通过邮箱验证码获取新凭证。", meta
        tid = int(row["id"])
        email_got = str(row["email"] or "").strip().lower()
        username_got = str(row["username"] or "").strip()
        invite_snap = str(row.get("invite_code_snapshot") or "").strip()
        if is_register_invite_required() and invite_snap != get_admin_invite_code():
            conn.rollback()
            return None, "邀请码无效", meta
        ok_slot, err_slot = _pg_register_slots_available(email_got, username_got)
        if not ok_slot:
            cur.execute(
                "UPDATE registration_tickets SET consumed_at = NOW() WHERE id = %s",
                (tid,),
            )
            conn.commit()
            return None, err_slot, meta
        pw_err = _register_password_strength_err(password, email=email_got, username=username_got)
        if pw_err:
            conn.rollback()
            return None, pw_err, meta
        pw_hash = generate_password_hash(password)
        uid_ins, err_ins = _pg_insert_user_with_credentials_on_cur(
            cur,
            phone=None,
            email=email_got,
            username=username_got,
            password_hash=pw_hash,
            display_name=username_got,
            email_verified_at=datetime.now(timezone.utc),
        )
        if err_ins or not uid_ins:
            conn.rollback()
            base = err_ins or "注册失败"
            if base.startswith("该邮箱") or base.startswith("该用户名") or base.startswith("该手机号"):
                return None, f"{base} 请从「发送验证码」起重新注册。", meta
            return None, f"{base} 当前凭证仍有效，可修改后再次点击注册，无需重新验证邮箱。", meta
        uid = str(uid_ins)
        cur.execute(
            "UPDATE registration_tickets SET consumed_at = NOW() WHERE id = %s",
            (tid,),
        )
        conn.commit()
    except PsycopgIntegrityError:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, "注册凭证或用户数据冲突，请重新获取验证码后再试", meta
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, "注册失败", meta
    finally:
        try:
            conn.autocommit = True
        except Exception:
            pass
        conn.close()
    row = _pg_fetch_auth_user_by_user_id(uid)
    if not row:
        return None, "注册后加载用户失败", meta
    tok = create_session(
        user_id=uid,
        phone=str(row.get("phone") or "").strip() or None,
        email=str(row.get("email") or "").strip().lower() or None,
        username=str(row.get("username") or "").strip() or None,
        feature_unlocked=False,
    )
    return tok, None, meta


def validate_phone(phone: str) -> bool:
    return bool(phone and PHONE_RE.match(phone.strip()))


def register_user(
    password: str,
    invite_code: str,
    *,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    username: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """
    新注册用户固定为 free 档。
    返回 (token, err, meta)；meta 可含 needs_email_verification=True。
    """
    meta: Dict[str, Any] = {}
    if not is_auth_enabled():
        return None, "认证未启用（服务端 FYV_AUTH_ENABLED）", meta
    p = (phone or "").strip() or None
    em = (email or "").strip().lower() or None
    un = (username or "").strip() or None
    if len((password or "")) < 6:
        return None, "密码至少 6 位", meta
    invite = (invite_code or "").strip()
    if is_register_invite_required() and invite != get_admin_invite_code():
        return None, "邀请码无效", meta

    if em or un:
        if not em:
            return None, "请填写邮箱", meta
        if not EMAIL_RE.match(em):
            return None, "邮箱格式无效", meta
        if not p:
            return None, "请填写绑定手机号（中国大陆 11 位）", meta
        if not validate_phone(p):
            return None, "手机号格式无效", meta
        un = ((username or "").strip() or p)
        if not USERNAME_RE.match(un):
            return None, "用户名为 3–32 位字母数字下划线", meta
        pw_err = _register_password_strength_err(password, email=em, username=un, phone=p)
        if pw_err:
            return None, pw_err, meta
        pw_hash = generate_password_hash(password)
        if not (_auth_pg_primary() and _pg_available()):
            return None, "当前环境需 PostgreSQL 才能使用邮箱注册", meta
        ev_at: Optional[datetime] = None
        if _truthy_env_email_auto_verify():
            ev_at = datetime.now(timezone.utc)
        uid, err_ins = _pg_insert_user_with_credentials(
            phone=p,
            email=em,
            username=un,
            password_hash=pw_hash,
            display_name=un,
            email_verified_at=ev_at,
        )
        if err_ins or not uid:
            return None, err_ins or "注册失败", meta
        if ev_at is not None:
            row = _pg_fetch_auth_user_by_user_id(uid)
            if row:
                return (
                    create_session(
                        user_id=uid,
                        phone=str(row.get("phone") or "") or None,
                        email=str(row.get("email") or "") or None,
                        username=str(row.get("username") or "") or None,
                        feature_unlocked=False,
                    ),
                    None,
                    meta,
                )
            return None, "注册后加载用户失败", meta
        raw_tok = _pg_store_email_verification_token(uid)
        base = _verify_base_url()
        link = f"{base}/verify-email?token={raw_tok}" if (base and raw_tok) else (raw_tok or "")
        sent = False
        if _email_smtp_configured() and raw_tok:
            ok_s, _ = _send_verification_email(em, link if base else f"(请配置 FYV_AUTH_VERIFY_BASE_URL) token={raw_tok}")
            sent = ok_s
        if _truthy_env_email_log_token() and raw_tok:
            print(f"[auth] email verification token for {em}: {link or raw_tok}")
        meta["needs_email_verification"] = True
        meta["verification_email_sent"] = bool(sent)
        return None, None, meta

    if not p or not validate_phone(p):
        return None, "请输入有效的中国大陆 11 位手机号，或使用邮箱注册", meta
    pw_err_phone = _register_password_strength_err(password, phone=p)
    if pw_err_phone:
        return None, pw_err_phone, meta
    pw_hash = generate_password_hash(password)
    if _auth_pg_primary() and _pg_available():
        row_existing = _pg_fetch_auth_user(p)
        if isinstance(row_existing, dict):
            st = str(row_existing.get("account_status") or "active").strip().lower()
            if st == "deleted":
                ok = _pg_revive_user_with_credentials(
                    user_id=str(row_existing.get("user_id") or ""),
                    phone=p,
                    password_hash=pw_hash,
                    display_name=p,
                    role="user",
                    plan="free",
                    billing_cycle=None,
                )
                if not ok:
                    return None, "注册失败（数据库写入失败）", meta
            elif st == "disabled":
                return None, "该账号已禁用", meta
            else:
                return None, "该手机号已注册", meta
        else:
            ok = _pg_upsert_user_and_auth(
                phone=p,
                password_hash=pw_hash,
                display_name=p,
                role="user",
                plan="free",
                billing_cycle=None,
            )
            if not ok:
                return None, "注册失败（数据库写入失败）", meta
        row = _pg_fetch_auth_user(p)
        uid = str((row or {}).get("user_id") or "")
        if uid:
            return (
                create_session(
                    user_id=uid,
                    phone=p,
                    email=str((row or {}).get("email") or "") or None,
                    username=str((row or {}).get("username") or "") or None,
                    feature_unlocked=False,
                ),
                None,
                meta,
            )
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if p in users and _auth_pg_primary() and _pg_available():
            pass
        users[p] = {
            "password_hash": pw_hash,
            "plan": "free",
            "billing_cycle": None,
            "role": "user",
            "display_name": p,
            "created_at": int(_now()),
        }
        _save_users(users)
    return create_session(user_id="", phone=p, feature_unlocked=False), None, meta


def verify_password(user_ref: str, password: str) -> bool:
    ref = (user_ref or "").strip()
    if not ref:
        return False
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user_by_login_identifier(ref)
        if not row and validate_phone(ref):
            row = _pg_fetch_auth_user(ref)
        if not row:
            row = _pg_fetch_auth_user_by_user_id(ref)
        if isinstance(row, dict):
            account_status = str(row.get("account_status") or "active").strip().lower()
            if account_status in ("disabled", "deleted"):
                return False
        else:
            row = None
        ph = row.get("password_hash") if isinstance(row, dict) else None
        if ph:
            ok = check_password_hash(str(ph), password)
            if _auth_dual_write() and validate_phone(ref):
                ju = _load_users().get(ref) if not _json_readonly_backup() else _load_json(USERS_FILE, {}).get(ref)
                if isinstance(ju, dict):
                    jh = ju.get("password_hash")
                    if jh and bool(check_password_hash(str(jh), password)) != bool(ok):
                        print(f"[auth-consistency] password mismatch ref={ref}")
            return ok
        if _json_readonly_backup():
            return False
    users = _load_users()
    u = users.get(ref)
    if not u or not isinstance(u, dict):
        return False
    ph = u.get("password_hash")
    if not ph:
        return False
    return check_password_hash(ph, password)


def login_user(login_id: str, password: str) -> Tuple[Optional[str], Optional[str]]:
    if not is_auth_enabled():
        return None, "认证未启用"
    lid = (login_id or "").strip()
    if not lid:
        return None, "账号或密码错误"
    if not (_auth_pg_primary() and _pg_available()):
        if not validate_phone(lid):
            return None, "手机号或密码错误"
        pg_row = None
    else:
        pg_row = _pg_fetch_auth_user_by_login_identifier(lid)
        if not pg_row and validate_phone(lid):
            pg_row = _pg_fetch_auth_user(lid)
    if isinstance(pg_row, dict):
        if _login_identifier_is_email_shape(lid) and pg_row.get("email_verified_at") is None:
            return None, "请先完成邮箱验证后再使用邮箱登录"
        lock_until = pg_row.get("locked_until")
        if isinstance(lock_until, datetime):
            try:
                now_dt = datetime.now(timezone.utc)
                lu = lock_until if lock_until.tzinfo else lock_until.replace(tzinfo=timezone.utc)
                if lu > now_dt:
                    return None, "账号已临时锁定，请稍后再试"
            except Exception:
                pass
    if not verify_password(lid, password):
        if isinstance(pg_row, dict):
            _pg_mark_login_failure(str(pg_row.get("user_id") or ""))
        return None, "账号或密码错误"
    if isinstance(pg_row, dict):
        _pg_mark_login_success(str(pg_row.get("user_id") or ""))
        return (
            create_session(
                user_id=str(pg_row.get("user_id") or ""),
                phone=str(pg_row.get("phone") or "").strip() or None,
                email=str(pg_row.get("email") or "").strip() or None,
                username=str(pg_row.get("username") or "").strip() or None,
                feature_unlocked=False,
            ),
            None,
        )
    if validate_phone(lid) and verify_password(lid, password):
        return create_session(user_id="", phone=lid, feature_unlocked=False), None
    return None, "账号或密码错误"


def create_session(
    *,
    user_id: str = "",
    phone: Optional[str] = None,
    email: Optional[str] = None,
    username: Optional[str] = None,
    feature_unlocked: bool = False,
) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    sess = {
        "user_id": (user_id or "").strip(),
        "phone": (phone or "").strip(),
        "email": (email or "").strip(),
        "username": (username or "").strip(),
        "created": now,
        "expires": now + SESSION_TTL_SEC,
        "feature_unlocked": bool(feature_unlocked),
        "feature_unlock_expires": (now + FEATURE_UNLOCK_TTL_SEC) if feature_unlocked else None,
    }
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                cli.set(_redis_key(token), json.dumps(sess, ensure_ascii=False), ex=_session_ttl_seconds(sess))
                return token
            except Exception:
                pass
    sessions = _load_sessions()
    _purge_expired_sessions(sessions)
    sessions[token] = sess
    _save_sessions(sessions)
    return token


def delete_session(token: str) -> None:
    if not token:
        return
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                cli.delete(_redis_key(token))
                return
            except Exception:
                pass
    sessions = _load_sessions()
    if token in sessions:
        del sessions[token]
        _save_sessions(sessions)


def _persist_session_dict(token: str, s: Dict[str, Any]) -> None:
    if not token or not isinstance(s, dict):
        return
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                cli.set(_redis_key(token), json.dumps(s, ensure_ascii=False), ex=_session_ttl_seconds(s))
            except Exception:
                pass
        return
    sessions = _load_sessions()
    _purge_expired_sessions(sessions)
    sessions[token] = s
    _save_sessions(sessions)


def _maybe_backfill_session_user_id(token: str, s: Dict[str, Any]) -> Dict[str, Any]:
    """旧会话仅有 phone/email/username 时，在 PG 主模式下补写 user_id 并落盘。"""
    if not token or not isinstance(s, dict):
        return s
    if str(s.get("user_id") or "").strip():
        return s
    if not (_auth_pg_primary() and _pg_available()):
        return s
    uid = ""
    for key in ("phone", "email", "username"):
        v = str(s.get(key) or "").strip()
        if not v:
            continue
        row = _pg_fetch_auth_user_by_login_identifier(v)
        if isinstance(row, dict) and row.get("user_id"):
            uid = str(row["user_id"])
            break
    if not uid:
        return s
    s = dict(s)
    s["user_id"] = uid
    _persist_session_dict(token, s)
    return s


def get_session(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                raw = cli.get(_redis_key(token))
                if not raw:
                    return None
                s = json.loads(raw)
                if not isinstance(s, dict):
                    return None
                if float(s.get("expires") or 0) < _now():
                    cli.delete(_redis_key(token))
                    return None
                if s.get("feature_unlocked") and s.get("feature_unlock_expires"):
                    if _now() > float(s["feature_unlock_expires"]):
                        s["feature_unlocked"] = False
                        s["feature_unlock_expires"] = None
                        cli.set(_redis_key(token), json.dumps(s, ensure_ascii=False), ex=_session_ttl_seconds(s))
                s = _maybe_backfill_session_user_id(token, s)
                return s
            except Exception:
                pass
    sessions = _load_sessions()
    _purge_expired_sessions(sessions)
    s = sessions.get(token)
    if not isinstance(s, dict):
        return None
    if float(s.get("expires") or 0) < _now():
        delete_session(token)
        return None
    # 功能解锁过期：需重新验证
    if s.get("feature_unlocked") and s.get("feature_unlock_expires"):
        if _now() > float(s["feature_unlock_expires"]):
            s["feature_unlocked"] = False
            s["feature_unlock_expires"] = None
            sessions[token] = s
            _save_sessions(sessions)
    s = _maybe_backfill_session_user_id(token, s)
    return s


def unlock_feature(token: str, password: str, login_id: str = "") -> Tuple[bool, Optional[str]]:
    sess = get_session(token)
    if not sess:
        return False, "登录已过期，请重新登录"
    uid = session_effective_user_id(sess)
    row = _pg_fetch_auth_user_by_user_id(uid) if uid and _pg_available() else None
    ok_pw = False
    if isinstance(row, dict) and row.get("password_hash"):
        ok_pw = bool(check_password_hash(str(row["password_hash"]), password))
    if not ok_pw:
        hint = (login_id or "").strip() or str(sess.get("phone") or sess.get("email") or sess.get("username") or uid or "")
        if not hint or not verify_password(hint, password):
            return False, "密码错误"
    now = _now()
    if _session_backend() == "redis":
        cli = _get_redis_client()
        if cli is not None:
            try:
                raw = cli.get(_redis_key(token))
                if not raw:
                    return False, "会话无效"
                s = json.loads(raw)
                if not isinstance(s, dict):
                    return False, "会话无效"
                s["feature_unlocked"] = True
                s["feature_unlock_expires"] = now + FEATURE_UNLOCK_TTL_SEC
                cli.set(_redis_key(token), json.dumps(s, ensure_ascii=False), ex=_session_ttl_seconds(s))
                return True, None
            except Exception:
                pass
    sessions = _load_sessions()
    s = sessions.get(token)
    if not isinstance(s, dict):
        return False, "会话无效"
    s["feature_unlocked"] = True
    s["feature_unlock_expires"] = now + FEATURE_UNLOCK_TTL_SEC
    sessions[token] = s
    _save_sessions(sessions)
    return True, None


def user_info_for_principal(ref: str) -> Dict[str, Any]:
    u: Dict[str, Any] = {}
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(ref)
        if isinstance(row, dict):
            u = row
    if not u:
        users = _load_users()
        u = users.get(ref) or {}
    uid = str(u.get("user_id") or "").strip()
    r = _normalize_role(u.get("role"))
    if is_admin_principal(ref) or (uid and is_admin_principal(uid)):
        r = "admin"
    phone_out = str(u.get("phone") or "").strip()
    dn = (
        str(u.get("display_name") or "").strip()
        or phone_out
        or str(u.get("username") or "").strip()
        or str(u.get("email") or "").strip()
        or ref
    )
    plan = _coerce_stored_plan(u.get("plan"))
    billing_cycle = _normalize_billing_cycle_for_plan(plan, u.get("billing_cycle"))
    return {
        "user_id": uid or None,
        "phone": phone_out or None,
        "email": str(u.get("email") or "").strip() or None,
        "username": str(u.get("username") or "").strip() or None,
        "email_verified": bool(u.get("email_verified_at")),
        "display_name": dn,
        "plan": plan,
        "billing_cycle": billing_cycle,
        "role": r,
    }


def user_info_for_phone(phone: str) -> Dict[str, Any]:
    """兼容旧调用：参数可为手机号、user_id(UUID)、邮箱或用户名。"""
    return user_info_for_principal(phone)


def user_info_from_session_token(token: str) -> Dict[str, Any]:
    sess = get_session(token) if token else None
    if not isinstance(sess, dict):
        return {}
    uid = session_effective_user_id(sess)
    if uid:
        return user_info_for_principal(uid)
    ph = str(sess.get("phone") or "").strip()
    if ph:
        return user_info_for_principal(ph)
    em = str(sess.get("email") or "").strip()
    if em:
        return user_info_for_principal(em)
    un = str(sess.get("username") or "").strip()
    if un:
        return user_info_for_principal(un)
    return {}


def is_admin_principal(ref: str) -> bool:
    p = (ref or "").strip()
    if not p:
        return False
    if p in _ops_admin_phone_set():
        return True
    if p in _ops_admin_user_ids_set():
        return True
    u: Dict[str, Any] = {}
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(p)
        if isinstance(row, dict):
            u = row
    if not u:
        users = _load_users()
        u = users.get(p) or {}
    uid = str(u.get("user_id") or "").strip()
    if uid and uid in _ops_admin_user_ids_set():
        return True
    return _normalize_role(u.get("role")) == "admin"


def is_admin_phone(phone: str) -> bool:
    return is_admin_principal(phone)


def update_display_name(principal: str, display_name: str) -> Tuple[bool, Optional[str]]:
    """principal：会话中的 user_id（UUID）或手机号等可解析标识。"""
    p = (principal or "").strip()
    dn = (display_name or "").strip()
    if len(dn) > 48:
        return False, "展示名过长"
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(p)
        if not row:
            return False, "用户不存在"
        uid = str(row.get("user_id") or "").strip()
        ph = str(row.get("phone") or "").strip()
        if not dn:
            dn = ph or str(row.get("username") or "") or str(row.get("email") or "") or uid
        if ph:
            ok = _pg_upsert_user_and_auth(
                phone=ph,
                display_name=dn,
                role=str(row.get("role") or "user"),
                plan=str(row.get("plan") or "free"),
                billing_cycle=(str(row.get("billing_cycle") or "").strip() or None),
            )
        else:
            ok = _pg_update_user_fields_by_user_id(
                uid,
                display_name=dn,
            )
        if not ok:
            return False, "更新失败"
    json_key = p
    if _auth_pg_primary() and _pg_available():
        rj = _resolve_auth_row_for_principal(p)
        if isinstance(rj, dict) and rj.get("phone"):
            json_key = str(rj.get("phone"))
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        jk = json_key if validate_phone(json_key) else p
        if jk not in users and validate_phone(p):
            jk = p
        if jk not in users:
            if not validate_phone(jk):
                return True, None
            users[jk] = {"display_name": dn, "plan": "free", "role": "user", "billing_cycle": None}
        rec = users[jk]
        if not isinstance(rec, dict):
            return False, "用户数据损坏"
        rec["display_name"] = dn
        users[jk] = rec
        _save_users(users)
    return True, None


def update_username(principal: str, username: str) -> Tuple[bool, Optional[str]]:
    """principal：会话中的 user_id（UUID）或手机号等可解析标识。"""
    p = (principal or "").strip()
    un = (username or "").strip()
    if not USERNAME_RE.match(un):
        return False, "用户名为 3–32 位字母数字下划线"
    if not (_auth_pg_primary() and _pg_available()):
        return False, "当前环境无法修改用户名"
    row = _resolve_auth_row_for_principal(p)
    if not row:
        return False, "用户不存在"
    uid = str(row.get("user_id") or "").strip()
    if not uid:
        return False, "用户不存在"
    cur_un = str(row.get("username") or "").strip()
    if cur_un.lower() == un.lower():
        return True, None
    if _pg_username_taken_by_other(uid, un):
        return False, "用户名已被占用"
    ok = _pg_update_user_fields_by_user_id(uid, username=un)
    if not ok:
        return False, "用户名已被占用或更新失败"
    return True, None


def set_user_subscription(user_ref: str, tier: str, cycle: Optional[str]) -> Tuple[bool, Optional[str]]:
    tier = (tier or "free").strip().lower()
    if tier not in VALID_PLANS:
        return False, "无效套餐"
    cycle = (cycle or "").strip().lower() if cycle else None
    if cycle and cycle not in VALID_BILLING:
        return False, "无效计费周期"
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(user_ref)
        if not row:
            row = _pg_fetch_auth_user(user_ref) if validate_phone(user_ref) else None
        if not isinstance(row, dict):
            return False, "用户不存在"
        uid = str(row.get("user_id") or "").strip()
        ph = str(row.get("phone") or "").strip()
        if ph:
            ok = _pg_upsert_user_and_auth(
                phone=ph,
                display_name=str(row.get("display_name") or ph),
                role=str(row.get("role") or "user"),
                plan=tier,
                billing_cycle=(cycle if tier != "free" else None),
            )
        else:
            ok = _pg_update_user_fields_by_user_id(
                uid,
                plan=tier,
                billing_cycle=(cycle if tier != "free" else None),
            )
        if not ok:
            return False, "更新失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        jk = user_ref.strip()
        if jk not in users:
            return False, "用户不存在"
        users[jk]["plan"] = tier
        users[jk]["billing_cycle"] = cycle if tier != "free" else None
        _save_users(users)
    return True, None


def set_user_role(user_ref: str, role: str) -> Tuple[bool, Optional[str]]:
    p = (user_ref or "").strip()
    r = _normalize_role(role)
    if r not in VALID_ROLES:
        return False, "无效角色"
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(p)
        if not row and validate_phone(p):
            row = _pg_fetch_auth_user(p)
        if not isinstance(row, dict):
            return False, "用户不存在"
        uid = str(row.get("user_id") or "").strip()
        ph = str(row.get("phone") or "").strip()
        if ph:
            ok = _pg_upsert_user_and_auth(
                phone=ph,
                display_name=str(row.get("display_name") or ph),
                role=r,
                plan=str(row.get("plan") or "free"),
                billing_cycle=(str(row.get("billing_cycle") or "").strip() or None),
            )
        else:
            ok = _pg_update_user_fields_by_user_id(uid, role=r)
        if not ok:
            return False, "设置失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if p not in users:
            return False, "用户不存在"
        users[p]["role"] = r
        _save_users(users)
    return True, None


def list_users_admin_view() -> list[Dict[str, Any]]:
    if _auth_pg_primary() and _pg_available():
        rows = _pg_list_users()
        if rows:
            out = []
            for raw in rows:
                out.append(
                    {
                        "user_id": str(raw.get("user_id") or ""),
                        "phone": str(raw.get("phone") or ""),
                        "email": str(raw.get("email") or ""),
                        "username": str(raw.get("username") or ""),
                        "plan": str(raw.get("plan") or "free"),
                        "billing_cycle": raw.get("billing_cycle"),
                        "role": _normalize_role(raw.get("role")),
                        "account_status": str(raw.get("account_status") or "active"),
                        "created_at": int(raw.get("created_at") or 0),
                        "has_password": bool(raw.get("has_password")),
                        "email_verified": bool(raw.get("email_verified")),
                    }
                )
            return out
    users = _load_users()
    out = []
    for phone, raw in users.items():
        if not isinstance(raw, dict):
            continue
        created_at = int(raw.get("created_at") or 0)
        out.append(
            {
                "phone": str(phone),
                "plan": str(raw.get("plan") or "free"),
                "billing_cycle": raw.get("billing_cycle"),
                "role": _normalize_role(raw.get("role")),
                "account_status": "active",
                "created_at": created_at,
                "has_password": bool(raw.get("password_hash")),
            }
        )
    out.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return out


def admin_create_user(phone: str, password: str, role: str = "user", plan: str = "free", billing_cycle: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    p = (phone or "").strip()
    if not validate_phone(p):
        return False, "请输入有效的中国大陆 11 位手机号"
    if len((password or "")) < 6:
        return False, "密码至少 6 位"
    r = _normalize_role(role)
    t = str(plan or "free").strip().lower()
    if t not in VALID_PLANS:
        return False, "无效套餐"
    cycle = str(billing_cycle or "").strip().lower() if billing_cycle else None
    if cycle and cycle not in VALID_BILLING:
        return False, "无效计费周期"

    pw_hash = generate_password_hash(password)
    reused_deleted_pg = False
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(p)
        if isinstance(row, dict):
            st = str(row.get("account_status") or "active").strip().lower()
            if st == "deleted":
                ok = _pg_revive_user_with_credentials(
                    user_id=str(row.get("user_id") or ""),
                    phone=p,
                    password_hash=pw_hash,
                    display_name=p,
                    role=r,
                    plan=t,
                    billing_cycle=(cycle if t != "free" else None),
                )
                if not ok:
                    return False, "新增用户失败"
                reused_deleted_pg = True
            elif st == "disabled":
                return False, "该手机号对应账号已禁用"
            else:
                return False, "该手机号已存在"
        else:
            ok = _pg_upsert_user_and_auth(
                phone=p,
                password_hash=pw_hash,
                display_name=p,
                role=r,
                plan=t,
                billing_cycle=(cycle if t != "free" else None),
            )
            if not ok:
                return False, "新增用户失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if p in users and not reused_deleted_pg:
            return False, "该手机号已存在"
        users[p] = {
            "password_hash": pw_hash,
            "plan": t,
            "billing_cycle": cycle if t != "free" else None,
            "role": r,
            "display_name": p,
            "created_at": int(_now()),
        }
        _save_users(users)
    return True, None


def admin_delete_user(user_ref: str) -> Tuple[bool, Optional[str]]:
    p = (user_ref or "").strip()
    if not p:
        return False, "用户标识无效"
    exists_pg = False
    if _auth_pg_primary() and _pg_available():
        row = _resolve_auth_row_for_principal(p)
        if not row and validate_phone(p):
            row = _pg_fetch_auth_user(p)
        if isinstance(row, dict):
            exists_pg = True
            ph = str(row.get("phone") or "").strip()
            uid = str(row.get("user_id") or "").strip()
            ok_del = _pg_delete_user(ph) if ph else _pg_soft_delete_user_by_id(uid)
            if not ok_del:
                return False, "删除失败"
    if (
        _auth_pg_primary()
        and _pg_available()
        and not exists_pg
        and not _auth_dual_write()
    ):
        return False, "用户不存在"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        jk = p
        if jk not in users and validate_phone(p):
            jk = p
        if jk in users:
            del users[jk]
            _save_users(users)
        elif not exists_pg:
            return False, "用户不存在"
    return True, None


def ensure_bootstrap_admin() -> Tuple[bool, str]:
    """
    可选：通过环境变量在启动时自动确保管理员账号存在。
    FYV_BOOTSTRAP_ADMIN_ENABLED=1
    FYV_BOOTSTRAP_ADMIN_PHONE=1xxxxxxxxxx
    FYV_BOOTSTRAP_ADMIN_PASSWORD=xxxxxx
    FYV_BOOTSTRAP_ADMIN_FORCE_PASSWORD=0/1
    """
    if not _truthy_env("FYV_BOOTSTRAP_ADMIN_ENABLED", "0"):
        return True, "bootstrap_admin_disabled"
    phone = (os.environ.get("FYV_BOOTSTRAP_ADMIN_PHONE") or "").strip()
    password = str(os.environ.get("FYV_BOOTSTRAP_ADMIN_PASSWORD") or "")
    force_pwd = _truthy_env("FYV_BOOTSTRAP_ADMIN_FORCE_PASSWORD", "0")
    if not validate_phone(phone):
        return False, "bootstrap_admin_phone_invalid"
    if len(password) < 6:
        return False, "bootstrap_admin_password_too_short"
    exists = bool(_pg_fetch_auth_user(phone)) if (_auth_pg_primary() and _pg_available()) else False
    if not exists:
        ok, err = admin_create_user(phone, password, role="admin", plan="max", billing_cycle="yearly")
        if not ok:
            return False, str(err or "bootstrap_admin_create_failed")
        return True, "bootstrap_admin_created"
    ok_role, err_role = set_user_role(phone, "admin")
    if not ok_role:
        return False, str(err_role or "bootstrap_admin_set_role_failed")
    ok_plan, err_plan = set_user_subscription(phone, "max", "yearly")
    if not ok_plan:
        return False, str(err_plan or "bootstrap_admin_set_plan_failed")
    if force_pwd:
        row = _pg_fetch_auth_user(phone)
        if isinstance(row, dict):
            _pg_upsert_user_and_auth(
                phone=phone,
                password_hash=generate_password_hash(password),
                display_name=str(row.get("display_name") or phone),
                role=str(row.get("role") or "admin"),
                plan=str(row.get("plan") or "max"),
                billing_cycle=(str(row.get("billing_cycle") or "").strip() or "yearly"),
            )
    return True, "bootstrap_admin_updated"


def auth_config_dict() -> Dict[str, Any]:
    return {
        "auth_required": bool(is_auth_enabled()),
        "invite_hint": "需要管理员提供的邀请码" if is_auth_enabled() and is_register_invite_required() else "",
        "unified_pg": bool(_auth_unified_pg_profile()),
        "pg_primary": bool(_auth_pg_primary()),
        "dual_write_json": bool(_auth_dual_write()),
        "json_readonly_backup": bool(_json_readonly_backup()),
    }


def guard_feature_request(req) -> Optional[Tuple]:
    """
    若需鉴权：校验 Bearer 与功能解锁。
    返回 None 表示通过；否则返回 (响应体 dict, status_code)。
    """
    if not is_auth_enabled():
        return None
    auth = (req.headers.get("Authorization") or "").strip()
    if not auth.startswith("Bearer "):
        return (
            jsonify({"success": False, "error": "未登录", "code": "AUTH_REQUIRED"}),
            401,
        )
    token = auth[7:].strip()
    sess = get_session(token)
    if not sess:
        return (
            jsonify({"success": False, "error": "登录已过期", "code": "AUTH_REQUIRED"}),
            401,
        )
    if not sess.get("feature_unlocked"):
        return (
            jsonify(
                {
                    "success": False,
                    "error": "使用功能前请验证账号密码",
                    "code": "FEATURE_AUTH_REQUIRED",
                }
            ),
            403,
        )
    exp = sess.get("feature_unlock_expires")
    if exp and _now() > float(exp):
        return (
            jsonify(
                {
                    "success": False,
                    "error": "验证已过期，请重新输入密码",
                    "code": "FEATURE_AUTH_REQUIRED",
                }
            ),
            403,
        )
    return None
