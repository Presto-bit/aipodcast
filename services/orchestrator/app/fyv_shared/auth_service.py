"""
本地用户认证与会话（手机号 + 密码）。
启用方式：环境变量 FYV_AUTH_ENABLED=1
邀请注册：FYV_ADMIN_INVITE_CODE（默认 fym-admin-2025）

数据文件位于 DATA_DIR：users.json、sessions.json（与音频等 outputs 分离）
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from werkzeug.security import check_password_hash, generate_password_hash
try:
    from redis import Redis
except Exception:  # pragma: no cover - 运行环境缺少 redis 包时自动回退文件会话
    Redis = None  # type: ignore[misc,assignment]
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except Exception:  # pragma: no cover - 运行环境缺少 psycopg2 时自动回退 JSON 认证
    psycopg2 = None  # type: ignore[assignment]
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
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

SESSION_TTL_SEC = 7 * 86400
FEATURE_UNLOCK_TTL_SEC = 8 * 3600

VALID_PLANS = frozenset({"free", "basic", "pro", "max"})
VALID_BILLING = frozenset({"monthly", "yearly"})
VALID_ROLES = frozenset({"user", "admin"})
AUTH_LOCK_MAX_FAILED_ATTEMPTS = int(os.environ.get("FYV_AUTH_LOCK_MAX_FAILED_ATTEMPTS", "5") or 5)
AUTH_LOCK_MINUTES = int(os.environ.get("FYV_AUTH_LOCK_MINUTES", "15") or 15)


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
        conn.commit()
    finally:
        conn.close()


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
              u.phone, u.plan, u.billing_cycle, u.role, u.account_status,
              EXTRACT(EPOCH FROM u.created_at)::bigint AS created_at,
              (a.password_hash IS NOT NULL) AS has_password
            FROM users u
            LEFT JOIN user_auth_accounts a ON a.user_id = u.id
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


def validate_phone(phone: str) -> bool:
    return bool(phone and PHONE_RE.match(phone.strip()))


def register_user(phone: str, password: str, invite_code: str) -> Tuple[Optional[str], Optional[str]]:
    """新注册用户固定为 free 档、无计费周期；付费档位仅在支付成功回调等路径写入。"""
    if not is_auth_enabled():
        return None, "认证未启用（服务端 FYV_AUTH_ENABLED）"
    phone = (phone or "").strip()
    if not validate_phone(phone):
        return None, "请输入有效的中国大陆 11 位手机号"
    if len((password or "")) < 6:
        return None, "密码至少 6 位"
    invite = (invite_code or "").strip()
    if invite != get_admin_invite_code():
        return None, "邀请码无效"
    pw_hash = generate_password_hash(password)
    if _auth_pg_primary() and _pg_available():
        exists = _pg_fetch_auth_user(phone)
        if exists:
            return None, "该手机号已注册"
        ok = _pg_upsert_user_and_auth(
            phone=phone,
            password_hash=pw_hash,
            display_name=phone,
            role="user",
            plan="free",
            billing_cycle=None,
        )
        if not ok:
            return None, "注册失败（数据库写入失败）"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if phone in users and _auth_pg_primary() and _pg_available():
            # 双写观察期：若 JSON 已存在但 PG 是新增，不拦截主流程，覆盖保持一致
            pass
        users[phone] = {
            "password_hash": pw_hash,
            "plan": "free",
            "billing_cycle": None,
            "role": "user",
            "display_name": phone,
            "created_at": int(_now()),
        }
        _save_users(users)
    return create_session(phone, feature_unlocked=False), None


def verify_password(phone: str, password: str) -> bool:
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(phone)
        if isinstance(row, dict):
            account_status = str(row.get("account_status") or "active").strip().lower()
            if account_status in ("disabled", "deleted"):
                return False
        ph = row.get("password_hash") if isinstance(row, dict) else None
        if ph:
            ok = check_password_hash(str(ph), password)
            if _auth_dual_write():
                # 双写观察期一致性比对（仅日志，不阻断）
                ju = _load_users().get(phone) if not _json_readonly_backup() else _load_json(USERS_FILE, {}).get(phone)
                if isinstance(ju, dict):
                    jh = ju.get("password_hash")
                    if jh and bool(check_password_hash(str(jh), password)) != bool(ok):
                        print(f"[auth-consistency] password mismatch phone={phone}")
            return ok
        if _json_readonly_backup():
            return False
    users = _load_users()
    u = users.get(phone)
    if not u or not isinstance(u, dict):
        return False
    ph = u.get("password_hash")
    if not ph:
        return False
    return check_password_hash(ph, password)


def login_user(phone: str, password: str) -> Tuple[Optional[str], Optional[str]]:
    if not is_auth_enabled():
        return None, "认证未启用"
    phone = (phone or "").strip()
    if not validate_phone(phone):
        return None, "手机号或密码错误"
    pg_row = _pg_fetch_auth_user(phone) if (_auth_pg_primary() and _pg_available()) else None
    if isinstance(pg_row, dict):
        lock_until = pg_row.get("locked_until")
        if isinstance(lock_until, datetime):
            try:
                now_dt = datetime.now(timezone.utc)
                lu = lock_until if lock_until.tzinfo else lock_until.replace(tzinfo=timezone.utc)
                if lu > now_dt:
                    return None, "账号已临时锁定，请稍后再试"
            except Exception:
                pass
    if not verify_password(phone, password):
        if isinstance(pg_row, dict):
            _pg_mark_login_failure(str(pg_row.get("user_id") or ""))
        return None, "手机号或密码错误"
    if isinstance(pg_row, dict):
        _pg_mark_login_success(str(pg_row.get("user_id") or ""))
    return create_session(phone, feature_unlocked=False), None


def create_session(phone: str, feature_unlocked: bool = False) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    sess = {
        "phone": phone,
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
    return s


def unlock_feature(token: str, phone: str, password: str) -> Tuple[bool, Optional[str]]:
    phone = (phone or "").strip()
    sess = get_session(token)
    if not sess:
        return False, "登录已过期，请重新登录"
    if sess.get("phone") != phone:
        return False, "手机号与当前登录不一致"
    if not verify_password(phone, password):
        return False, "手机号或密码错误"
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


def user_info_for_phone(phone: str) -> Dict[str, Any]:
    u: Dict[str, Any] = {}
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(phone)
        if isinstance(row, dict):
            u = row
    if not u:
        users = _load_users()
        u = users.get(phone) or {}
    r = _normalize_role(u.get("role"))
    # 与 is_admin_phone / 管理 API 一致：运维名单 FYV_OPS_ADMIN_PHONES 也应在 /me 中带上 admin，前端才显示「后台管理」
    if is_admin_phone(phone):
        r = "admin"
    dn = str(u.get("display_name") or phone).strip() or phone
    plan = _coerce_stored_plan(u.get("plan"))
    billing_cycle = _normalize_billing_cycle_for_plan(plan, u.get("billing_cycle"))
    return {
        "phone": phone,
        "display_name": dn,
        "plan": plan,
        "billing_cycle": billing_cycle,
        "role": r,
    }


def is_admin_phone(phone: str) -> bool:
    p = (phone or "").strip()
    if not p:
        return False
    if p in _ops_admin_phone_set():
        return True
    u: Dict[str, Any] = {}
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(p)
        if isinstance(row, dict):
            u = row
    if not u:
        users = _load_users()
        u = users.get(p) or {}
    return _normalize_role(u.get("role")) == "admin"


def update_display_name(phone: str, display_name: str) -> Tuple[bool, Optional[str]]:
    """更新展示名（写入 users.json）；与 PG users.display_name 由编排器同步。"""
    p = (phone or "").strip()
    if not validate_phone(p):
        return False, "手机号无效"
    dn = (display_name or "").strip()
    if len(dn) > 48:
        return False, "展示名过长"
    if not dn:
        dn = p
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(p)
        if not row:
            return False, "用户不存在"
        ok = _pg_upsert_user_and_auth(
            phone=p,
            display_name=dn,
            role=str(row.get("role") or "user"),
            plan=str(row.get("plan") or "free"),
            billing_cycle=(str(row.get("billing_cycle") or "").strip() or None),
        )
        if not ok:
            return False, "更新失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if p not in users:
            users[p] = {"display_name": dn, "plan": "free", "role": "user", "billing_cycle": None}
        rec = users[p]
        if not isinstance(rec, dict):
            return False, "用户数据损坏"
        rec["display_name"] = dn
        users[p] = rec
        _save_users(users)
    return True, None


def set_user_subscription(phone: str, tier: str, cycle: Optional[str]) -> Tuple[bool, Optional[str]]:
    tier = (tier or "free").strip().lower()
    if tier not in VALID_PLANS:
        return False, "无效套餐"
    cycle = (cycle or "").strip().lower() if cycle else None
    if cycle and cycle not in VALID_BILLING:
        return False, "无效计费周期"
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(phone)
        if not row:
            return False, "用户不存在"
        ok = _pg_upsert_user_and_auth(
            phone=phone,
            display_name=str(row.get("display_name") or phone),
            role=str(row.get("role") or "user"),
            plan=tier,
            billing_cycle=(cycle if tier != "free" else None),
        )
        if not ok:
            return False, "更新失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if phone not in users:
            return False, "用户不存在"
        users[phone]["plan"] = tier
        users[phone]["billing_cycle"] = cycle if tier != "free" else None
        _save_users(users)
    return True, None


def set_user_role(phone: str, role: str) -> Tuple[bool, Optional[str]]:
    p = (phone or "").strip()
    if not validate_phone(p):
        return False, "手机号格式无效"
    r = _normalize_role(role)
    if r not in VALID_ROLES:
        return False, "无效角色"
    if _auth_pg_primary() and _pg_available():
        row = _pg_fetch_auth_user(p)
        if not row:
            return False, "用户不存在"
        ok = _pg_upsert_user_and_auth(
            phone=p,
            display_name=str(row.get("display_name") or p),
            role=r,
            plan=str(row.get("plan") or "free"),
            billing_cycle=(str(row.get("billing_cycle") or "").strip() or None),
        )
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
                        "phone": str(raw.get("phone") or ""),
                        "plan": str(raw.get("plan") or "free"),
                        "billing_cycle": raw.get("billing_cycle"),
                        "role": _normalize_role(raw.get("role")),
                        "account_status": str(raw.get("account_status") or "active"),
                        "created_at": int(raw.get("created_at") or 0),
                        "has_password": bool(raw.get("has_password")),
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
    if _auth_pg_primary() and _pg_available():
        if _pg_fetch_auth_user(p):
            return False, "该手机号已存在"
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
        if p in users:
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


def admin_delete_user(phone: str) -> Tuple[bool, Optional[str]]:
    p = (phone or "").strip()
    if not validate_phone(p):
        return False, "手机号格式无效"
    exists_pg = False
    if _auth_pg_primary() and _pg_available():
        exists_pg = bool(_pg_fetch_auth_user(p))
        if exists_pg and not _pg_delete_user(p):
            return False, "删除失败"
    if _auth_dual_write() or not _auth_pg_primary() or not _pg_available():
        users = _load_users()
        if p in users:
            del users[p]
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
        "invite_hint": "需要管理员提供的邀请码" if is_auth_enabled() else "",
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
