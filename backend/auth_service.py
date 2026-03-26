"""
本地用户认证与会话（手机号 + 密码）。
启用方式：环境变量 FYV_AUTH_ENABLED=1
邀请注册：FYV_ADMIN_INVITE_CODE（默认 fym-admin-2025）

数据文件位于 OUTPUT_DIR：users.json、sessions.json（已由 .gitignore 覆盖的 outputs 目录）
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import secrets
from typing import Any, Dict, Optional, Tuple

from flask import jsonify
from werkzeug.security import check_password_hash, generate_password_hash

from config import OUTPUT_DIR

USERS_FILE = os.path.join(OUTPUT_DIR, "users.json")
SESSIONS_FILE = os.path.join(OUTPUT_DIR, "sessions.json")

_lock = threading.Lock()
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

SESSION_TTL_SEC = 7 * 86400
FEATURE_UNLOCK_TTL_SEC = 8 * 3600

VALID_PLANS = frozenset({"free", "pro", "max"})
VALID_BILLING = frozenset({"monthly", "yearly"})


def is_auth_enabled() -> bool:
    v = (os.environ.get("FYV_AUTH_ENABLED") or "0").strip().lower()
    return v not in ("0", "false", "no", "off", "")


def get_admin_invite_code() -> str:
    return (os.environ.get("FYV_ADMIN_INVITE_CODE") or "fym-admin-2025").strip()


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
    with _lock:
        raw = _load_json(SESSIONS_FILE, {})
        return raw if isinstance(raw, dict) else {}


def _save_sessions(sessions: Dict[str, Any]) -> None:
    _save_json(SESSIONS_FILE, sessions)


def _now() -> float:
    return time.time()


def _purge_expired_sessions(sessions: Dict[str, Any]) -> None:
    t = _now()
    dead = [k for k, s in sessions.items() if isinstance(s, dict) and float(s.get("expires") or 0) < t]
    for k in dead:
        del sessions[k]


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
    if invite != get_admin_invite_code():
        return None, "邀请码无效"
    users = _load_users()
    if phone in users:
        return None, "该手机号已注册"
    users[phone] = {
        "password_hash": generate_password_hash(password),
        "plan": "free",
        "billing_cycle": None,
        "created_at": int(_now()),
    }
    _save_users(users)
    return create_session(phone, feature_unlocked=False), None


def verify_password(phone: str, password: str) -> bool:
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
    if not verify_password(phone, password):
        return None, "手机号或密码错误"
    return create_session(phone, feature_unlocked=False), None


def create_session(phone: str, feature_unlocked: bool = False) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    sessions = _load_sessions()
    _purge_expired_sessions(sessions)
    fu_exp = (now + FEATURE_UNLOCK_TTL_SEC) if feature_unlocked else None
    sessions[token] = {
        "phone": phone,
        "created": now,
        "expires": now + SESSION_TTL_SEC,
        "feature_unlocked": bool(feature_unlocked),
        "feature_unlock_expires": fu_exp,
    }
    _save_sessions(sessions)
    return token


def delete_session(token: str) -> None:
    if not token:
        return
    sessions = _load_sessions()
    if token in sessions:
        del sessions[token]
        _save_sessions(sessions)


def get_session(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
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
    users = _load_users()
    u = users.get(phone) or {}
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
    users = _load_users()
    if phone not in users:
        return False, "用户不存在"
    users[phone]["plan"] = tier
    users[phone]["billing_cycle"] = cycle if tier != "free" else None
    _save_users(users)
    return True, None


def auth_config_dict() -> Dict[str, Any]:
    return {
        "auth_required": bool(is_auth_enabled()),
        "invite_hint": "需要管理员提供的邀请码" if is_auth_enabled() else "",
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
