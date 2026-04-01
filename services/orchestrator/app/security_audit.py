"""跨用户资源访问尝试（IDOR）审计日志。"""

from __future__ import annotations

import logging

_logger = logging.getLogger("app.security")


def log_idor_denied(resource: str, resource_id: str, actor_ref: str | None) -> None:
    """当已登录用户访问他人资源时记录（与「不存在」区分）。"""
    aid = (actor_ref or "").strip()
    rid = (resource_id or "").strip()
    rtype = (resource or "").strip() or "unknown"
    _logger.warning("idor_denied resource=%s id=%s actor=%s", rtype, rid, aid[:64] if aid else "")
