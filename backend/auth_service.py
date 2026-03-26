"""
本地用户认证与会话（手机号 + 密码）。
启用方式：环境变量 FYV_AUTH_ENABLED=1
邀请注册：FYV_ADMIN_INVITE_CODE（默认 fym-admin-2025），可通过 FYV_REQUIRE_INVITE=1 强制

存储升级：
- 默认使用 SQLite：OUTPUT_DIR/auth.db（生产更稳）
- 首次启动会自动迁移旧 users.json / sessions.json
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import secrets
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple, TypeVar

from flask import jsonify
from werkzeug.security import check_password_hash, generate_password_hash

from config import OUTPUT_DIR

USERS_FILE = os.path.join(OUTPUT_DIR, "users.json")
SESSIONS_FILE = os.path.join(OUTPUT_DIR, "sessions.json")
AUTH_DB_FILE = os.path.join(OUTPUT_DIR, "auth.db")

_lock = threading.RLock()
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

SESSION_TTL_SEC = 7 * 86400
FEATURE_UNLOCK_TTL_SEC = 8 * 3600
RESET_CODE_TTL_SEC = 10 * 60
RESET_CODE_DIGITS = 6

VALID_PLANS = frozenset({"free", "pro", "max"})
VALID_BILLING = frozenset({"monthly", "yearly"})

@dataclass(frozen=True)
class RatePolicy:
    scope: str
    max_fails: int
    window_sec: int
    block_sec: int


RATE_LOGIN = RatePolicy("login", 5, 10 * 60, 15 * 60)  # 10分钟5次失败，封禁15分钟
RATE_UNLOCK = RatePolicy("unlock", 5, 10 * 60, 15 * 60)
RATE_RESET = RatePolicy("reset", 5, 10 * 60, 15 * 60)
RATE_FORGOT = RatePolicy("forgot", 8, 10 * 60, 10 * 60)


def is_auth_enabled() -> bool:
    v = (os.environ.get("FYV_AUTH_ENABLED") or "0").strip().lower()
    return v not in ("0", "false", "no", "off", "")


def get_admin_invite_code() -> str:
    return (os.environ.get("FYV_ADMIN_INVITE_CODE") or "fym-admin-2025").strip()


def is_invite_required() -> bool:
    v = (os.environ.get("FYV_REQUIRE_INVITE") or "0").strip().lower()
    return v not in ("0", "false", "no", "off", "")


def is_reset_debug_mode() -> bool:
    v = (os.environ.get("FYV_AUTH_DEBUG_RESET_CODE") or "0").strip().lower()
    return v not in ("0", "false", "no", "off", "")


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


def _db_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(AUTH_DB_FILE) or ".", exist_ok=True)
    conn = sqlite3.connect(AUTH_DB_FILE, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


T = TypeVar("T")


def _db_call(fn: Callable[[sqlite3.Connection], T], *, commit: bool = False) -> T:
    """统一数据库访问样板：加锁、连接生命周期、可选提交。"""
    with _lock:
        conn = _db_conn()
        try:
            result = fn(conn)
            if commit:
                conn.commit()
            return result
        finally:
            conn.close()


def _init_db() -> None:
    with _lock:
        conn = _db_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    phone TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    plan TEXT NOT NULL DEFAULT 'free',
                    billing_cycle TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    phone TEXT NOT NULL,
                    created REAL NOT NULL,
                    expires REAL NOT NULL,
                    feature_unlocked INTEGER NOT NULL DEFAULT 0,
                    feature_unlock_expires REAL
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_rate_limits (
                    scope TEXT NOT NULL,
                    k TEXT NOT NULL,
                    fail_count INTEGER NOT NULL,
                    first_failed_at REAL NOT NULL,
                    blocked_until REAL NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (scope, k)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS password_resets (
                    phone TEXT PRIMARY KEY,
                    code_hash TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL
                )
                """
            )
            conn.commit()
            _migrate_json_if_needed(conn)
        finally:
            conn.close()


def _migrate_json_if_needed(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    has_users = cur.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    if has_users:
        return
    users = _load_json(USERS_FILE, {})
    sessions = _load_json(SESSIONS_FILE, {})
    now_i = int(_now())
    if isinstance(users, dict):
        for phone, u in users.items():
            if not isinstance(u, dict):
                continue
            ph = str(u.get("password_hash") or "").strip()
            if not phone or not ph:
                continue
            cur.execute(
                """
                INSERT OR IGNORE INTO users(phone, password_hash, plan, billing_cycle, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (
                    str(phone).strip(),
                    ph,
                    str(u.get("plan") or "free"),
                    u.get("billing_cycle"),
                    int(u.get("created_at") or now_i),
                    now_i,
                ),
            )
    if isinstance(sessions, dict):
        for token, s in sessions.items():
            if not isinstance(s, dict):
                continue
            phone = str(s.get("phone") or "").strip()
            if not token or not phone:
                continue
            cur.execute(
                """
                INSERT OR IGNORE INTO sessions(token, phone, created, expires, feature_unlocked, feature_unlock_expires)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (
                    str(token).strip(),
                    phone,
                    float(s.get("created") or _now()),
                    float(s.get("expires") or (_now() + SESSION_TTL_SEC)),
                    1 if bool(s.get("feature_unlocked")) else 0,
                    float(s.get("feature_unlock_expires")) if s.get("feature_unlock_expires") else None,
                ),
            )
    conn.commit()


def _now() -> float:
    return time.time()


def _purge_expired_sessions_db(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires < ?", (_now(),))
    conn.commit()


def _rate_check(scope: str, key: str, max_fails: int, window_sec: int, block_sec: int) -> Tuple[bool, int]:
    def _inner(conn: sqlite3.Connection) -> Tuple[bool, int]:
        now = _now()
        row = conn.execute(
            "SELECT fail_count, first_failed_at, blocked_until FROM auth_rate_limits WHERE scope=? AND k=?",
            (scope, key),
        ).fetchone()
        if not row:
            return True, 0
        blocked_until = float(row["blocked_until"] or 0)
        if blocked_until > now:
            return False, max(1, int(blocked_until - now))
        if now - float(row["first_failed_at"] or 0) > window_sec:
            return True, 0
        if int(row["fail_count"] or 0) >= max_fails:
            new_blocked = now + block_sec
            conn.execute(
                """
                UPDATE auth_rate_limits
                SET blocked_until=?, updated_at=?
                WHERE scope=? AND k=?
                """,
                (new_blocked, now, scope, key),
            )
            conn.commit()
            return False, block_sec
        return True, 0

    return _db_call(_inner)


def _rate_check_policy(policy: RatePolicy, key: str) -> Tuple[bool, int]:
    return _rate_check(policy.scope, key, policy.max_fails, policy.window_sec, policy.block_sec)


def _rate_fail(scope: str, key: str, window_sec: int) -> None:
    def _inner(conn: sqlite3.Connection) -> None:
        now = _now()
        row = conn.execute(
            "SELECT fail_count, first_failed_at FROM auth_rate_limits WHERE scope=? AND k=?",
            (scope, key),
        ).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO auth_rate_limits(scope, k, fail_count, first_failed_at, blocked_until, updated_at)
                VALUES(?, ?, 1, ?, 0, ?)
                """,
                (scope, key, now, now),
            )
            return
        first = float(row["first_failed_at"] or now)
        if now - first > window_sec:
            conn.execute(
                """
                UPDATE auth_rate_limits
                SET fail_count=1, first_failed_at=?, blocked_until=0, updated_at=?
                WHERE scope=? AND k=?
                """,
                (now, now, scope, key),
            )
            return
        conn.execute(
            """
            UPDATE auth_rate_limits
            SET fail_count=fail_count+1, updated_at=?
            WHERE scope=? AND k=?
            """,
            (now, scope, key),
        )

    _db_call(_inner, commit=True)


def _rate_fail_policy(policy: RatePolicy, key: str) -> None:
    _rate_fail(policy.scope, key, policy.window_sec)


def _rate_success(scope: str, key: str) -> None:
    _db_call(
        lambda conn: conn.execute("DELETE FROM auth_rate_limits WHERE scope=? AND k=?", (scope, key)),
        commit=True,
    )


def _rate_success_policy(policy: RatePolicy, key: str) -> None:
    _rate_success(policy.scope, key)


def validate_phone(phone: str) -> bool:
    return bool(phone and PHONE_RE.match(phone.strip()))


def register_user(phone: str, password: str, invite_code: str) -> Tuple[Optional[str], Optional[str]]:
    if not is_auth_enabled():
        return None, "认证未启用（服务端 FYV_AUTH_ENABLED）"
    phone = (phone or "").strip()
    if not validate_phone(phone):
        return None, "请输入有效的中国大陆 11 位手机号"
    if len((password or "")) < 6:
        return None, "密码至少 6 位"
    invite = (invite_code or "").strip()
    if is_invite_required() and invite != get_admin_invite_code():
        return None, "邀请码无效"
    with _lock:
        conn = _db_conn()
        try:
            row = conn.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone()
            if row:
                return None, "该手机号已注册"
            now_i = int(_now())
            conn.execute(
                """
                INSERT INTO users(phone, password_hash, plan, billing_cycle, created_at, updated_at)
                VALUES(?, ?, 'free', NULL, ?, ?)
                """,
                (phone, generate_password_hash(password), now_i, now_i),
            )
            conn.commit()
        finally:
            conn.close()
    return create_session(phone, feature_unlocked=False), None


def verify_password(phone: str, password: str) -> bool:
    row = _db_call(lambda conn: conn.execute("SELECT password_hash FROM users WHERE phone=?", (phone,)).fetchone())
    ph = row["password_hash"] if row else None
    if not ph:
        return False
    return check_password_hash(ph, password)


def login_user(phone: str, password: str) -> Tuple[Optional[str], Optional[str]]:
    if not is_auth_enabled():
        return None, "认证未启用"
    phone = (phone or "").strip()
    ok, wait_sec = _rate_check_policy(RATE_LOGIN, phone)
    if not ok:
        return None, f"尝试过于频繁，请 {wait_sec} 秒后再试"
    if not validate_phone(phone):
        _rate_fail_policy(RATE_LOGIN, phone)
        return None, "手机号或密码错误"
    if not verify_password(phone, password):
        _rate_fail_policy(RATE_LOGIN, phone)
        return None, "手机号或密码错误"
    _rate_success_policy(RATE_LOGIN, phone)
    return create_session(phone, feature_unlocked=False), None


def create_session(phone: str, feature_unlocked: bool = False) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    with _lock:
        conn = _db_conn()
        try:
            _purge_expired_sessions_db(conn)
            fu_exp = (now + FEATURE_UNLOCK_TTL_SEC) if feature_unlocked else None
            conn.execute(
                """
                INSERT INTO sessions(token, phone, created, expires, feature_unlocked, feature_unlock_expires)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (token, phone, now, now + SESSION_TTL_SEC, 1 if feature_unlocked else 0, fu_exp),
            )
            conn.commit()
        finally:
            conn.close()
    return token


def delete_session(token: str) -> None:
    if not token:
        return
    _db_call(lambda conn: conn.execute("DELETE FROM sessions WHERE token=?", (token,)), commit=True)


def delete_sessions_for_phone(phone: str) -> None:
    if not phone:
        return
    _db_call(lambda conn: conn.execute("DELETE FROM sessions WHERE phone=?", (phone,)), commit=True)


def get_session(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    with _lock:
        conn = _db_conn()
        try:
            _purge_expired_sessions_db(conn)
            row = conn.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
            if not row:
                return None
            s = dict(row)
            if float(s.get("expires") or 0) < _now():
                conn.execute("DELETE FROM sessions WHERE token=?", (token,))
                conn.commit()
                return None
            if s.get("feature_unlocked") and s.get("feature_unlock_expires"):
                if _now() > float(s["feature_unlock_expires"]):
                    s["feature_unlocked"] = 0
                    s["feature_unlock_expires"] = None
                    conn.execute(
                        "UPDATE sessions SET feature_unlocked=0, feature_unlock_expires=NULL WHERE token=?",
                        (token,),
                    )
                    conn.commit()
            return {
                "phone": s.get("phone"),
                "created": s.get("created"),
                "expires": s.get("expires"),
                "feature_unlocked": bool(s.get("feature_unlocked")),
                "feature_unlock_expires": s.get("feature_unlock_expires"),
            }
        finally:
            conn.close()
    return None


def unlock_feature(token: str, phone: str, password: str) -> Tuple[bool, Optional[str]]:
    phone = (phone or "").strip()
    ok, wait_sec = _rate_check_policy(RATE_UNLOCK, phone)
    if not ok:
        return False, f"尝试过于频繁，请 {wait_sec} 秒后再试"
    sess = get_session(token)
    if not sess:
        return False, "登录已过期，请重新登录"
    if sess.get("phone") != phone:
        _rate_fail_policy(RATE_UNLOCK, phone)
        return False, "手机号与当前登录不一致"
    if not verify_password(phone, password):
        _rate_fail_policy(RATE_UNLOCK, phone)
        return False, "手机号或密码错误"
    now = _now()
    with _lock:
        conn = _db_conn()
        try:
            conn.execute(
                """
                UPDATE sessions
                SET feature_unlocked=1, feature_unlock_expires=?
                WHERE token=?
                """,
                (now + FEATURE_UNLOCK_TTL_SEC, token),
            )
            conn.commit()
        finally:
            conn.close()
    _rate_success_policy(RATE_UNLOCK, phone)
    return True, None


def user_info_for_phone(phone: str) -> Dict[str, Any]:
    row = _db_call(lambda conn: conn.execute("SELECT plan, billing_cycle FROM users WHERE phone=?", (phone,)).fetchone())
    u = dict(row) if row else {}
    return {
        "phone": phone,
        "plan": u.get("plan") or "free",
        "billing_cycle": u.get("billing_cycle"),
    }


def set_user_subscription(phone: str, tier: str, cycle: Optional[str]) -> Tuple[bool, Optional[str]]:
    tier = (tier or "free").strip().lower()
    if tier not in VALID_PLANS:
        return False, "无效套餐"
    cycle = (cycle or "").strip().lower() if cycle else None
    if cycle and cycle not in VALID_BILLING:
        return False, "无效计费周期"
    with _lock:
        conn = _db_conn()
        try:
            row = conn.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone()
            if not row:
                return False, "用户不存在"
            conn.execute(
                """
                UPDATE users
                SET plan=?, billing_cycle=?, updated_at=?
                WHERE phone=?
                """,
                (tier, cycle if tier != "free" else None, int(_now()), phone),
            )
            conn.commit()
        finally:
            conn.close()
    return True, None


def request_password_reset(phone: str) -> Tuple[bool, Optional[str], Optional[str]]:
    phone = (phone or "").strip()
    if not validate_phone(phone):
        return False, "请输入有效手机号", None
    ok, wait_sec = _rate_check_policy(RATE_FORGOT, phone)
    if not ok:
        return False, f"发送过于频繁，请 {wait_sec} 秒后再试", None
    with _lock:
        conn = _db_conn()
        try:
            row = conn.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone()
            # 无论用户存在与否，保持统一响应，避免枚举手机号
            reset_code = f"{secrets.randbelow(10**RESET_CODE_DIGITS):0{RESET_CODE_DIGITS}d}"
            if row:
                conn.execute(
                    """
                    INSERT INTO password_resets(phone, code_hash, expires_at, used, created_at)
                    VALUES(?, ?, ?, 0, ?)
                    ON CONFLICT(phone) DO UPDATE SET
                        code_hash=excluded.code_hash,
                        expires_at=excluded.expires_at,
                        used=0,
                        created_at=excluded.created_at
                    """,
                    (phone, generate_password_hash(reset_code), _now() + RESET_CODE_TTL_SEC, _now()),
                )
                conn.commit()
            _rate_success_policy(RATE_FORGOT, phone)
            return True, None, reset_code if is_reset_debug_mode() else None
        finally:
            conn.close()


def reset_password(phone: str, reset_code: str, new_password: str) -> Tuple[bool, Optional[str]]:
    phone = (phone or "").strip()
    reset_code = (reset_code or "").strip()
    if not validate_phone(phone):
        return False, "请输入有效手机号"
    if len((new_password or "")) < 6:
        return False, "新密码至少 6 位"
    ok, wait_sec = _rate_check_policy(RATE_RESET, phone)
    if not ok:
        return False, f"尝试过于频繁，请 {wait_sec} 秒后再试"
    with _lock:
        conn = _db_conn()
        try:
            row = conn.execute(
                "SELECT code_hash, expires_at, used FROM password_resets WHERE phone=?",
                (phone,),
            ).fetchone()
            if not row:
                _rate_fail_policy(RATE_RESET, phone)
                return False, "验证码无效或已过期"
            if int(row["used"] or 0) == 1 or float(row["expires_at"] or 0) < _now():
                _rate_fail_policy(RATE_RESET, phone)
                return False, "验证码无效或已过期"
            if not check_password_hash(str(row["code_hash"]), reset_code):
                _rate_fail_policy(RATE_RESET, phone)
                return False, "验证码错误"
            u = conn.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone()
            if not u:
                _rate_fail_policy(RATE_RESET, phone)
                return False, "用户不存在"
            now_i = int(_now())
            conn.execute(
                "UPDATE users SET password_hash=?, updated_at=? WHERE phone=?",
                (generate_password_hash(new_password), now_i, phone),
            )
            conn.execute("UPDATE password_resets SET used=1 WHERE phone=?", (phone,))
            conn.execute("DELETE FROM sessions WHERE phone=?", (phone,))
            conn.commit()
            _rate_success_policy(RATE_RESET, phone)
            return True, None
        finally:
            conn.close()


def auth_config_dict() -> Dict[str, Any]:
    invite_required = bool(is_auth_enabled() and is_invite_required())
    return {
        "auth_required": bool(is_auth_enabled()),
        "invite_required": invite_required,
        "invite_hint": "需要管理员提供的邀请码" if invite_required else "",
        "password_reset_enabled": bool(is_auth_enabled()),
        "password_reset_debug": bool(is_auth_enabled() and is_reset_debug_mode()),
    }


def guard_feature_request(req) -> Optional[Tuple]:
    """
    若需鉴权：校验 Bearer 与功能解锁。
    返回 None 表示通过；否则返回 (jsonify(...), status_code)。
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


_init_db()
