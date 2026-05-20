"""生产环境启动期安全校验（失败则退出进程）。"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

from .config import settings

_WEAK_INTERNAL_SECRETS = frozenset(
    {
        "",
        "local-internal-secret",
        "changeme",
        "secret",
        "test",
    }
)


def _truthy_production() -> bool:
    return (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")


def _truthy_env(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


def assert_production_security_or_exit() -> None:
    """
    FYV_PRODUCTION=1 时强制：
    - INTERNAL_SIGNING_SECRET 至少 32 字符且非已知弱默认值；
    - 禁止 PAYMENT_WEBHOOK_ALLOW_UNSIGNED（支付回调须验签）；
    - 禁止邮件「日志发码」与跳过验证（须走真实 SMTP + 收件验证）。
    """
    if not _truthy_production():
        return
    secret = (os.environ.get("INTERNAL_SIGNING_SECRET") or "").strip()
    if len(secret) < 32 or secret in _WEAK_INTERNAL_SECRETS or secret.lower() in _WEAK_INTERNAL_SECRETS:
        print(
            "[startup_security] FYV_PRODUCTION=1 要求 INTERNAL_SIGNING_SECRET 为至少 32 字节的强随机串，"
            "且不能使用示例默认值。",
            file=sys.stderr,
        )
        sys.exit(1)
    if (os.environ.get("PAYMENT_WEBHOOK_ALLOW_UNSIGNED") or "").strip().lower() in ("1", "true", "yes", "on"):
        print(
            "[startup_security] 生产环境禁止 PAYMENT_WEBHOOK_ALLOW_UNSIGNED=1，"
            "请配置 PAYMENT_WEBHOOK_SECRET 并令网关发送 X-Payment-Signature。",
            file=sys.stderr,
        )
        sys.exit(1)
    if _truthy_env("FYV_AUTH_EMAIL_LOG_TOKEN"):
        print(
            "[startup_security] 生产环境禁止 FYV_AUTH_EMAIL_LOG_TOKEN=1（仅日志发码、不落邮筒）；"
            "请配置 FYV_SMTP_* 并关闭该开关。",
            file=sys.stderr,
        )
        sys.exit(1)
    if _truthy_env("FYV_AUTH_EMAIL_AUTOVERIFY"):
        print(
            "[startup_security] 生产环境禁止 FYV_AUTH_EMAIL_AUTOVERIFY=1（跳过邮箱验证）；"
            "注册与验证链路必须经真实收件。",
            file=sys.stderr,
        )
        sys.exit(1)
    if getattr(settings, "embed_rq_media_worker", False) or getattr(settings, "embed_rq_ai_worker", False):
        print(
            "[startup_security] 生产环境禁止在编排器进程内嵌 RQ Worker；"
            "请设置 ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=0、ORCHESTRATOR_EMBED_RQ_AI_WORKER=0 并独立部署 ai-worker / media-worker。",
            file=sys.stderr,
        )
        sys.exit(1)
    presign = (settings.object_presign_endpoint or "").strip()
    if not presign:
        print(
            "[startup_security] 生产环境必须设置 OBJECT_PRESIGN_ENDPOINT=https://公网可访问的 MinIO/S3 API 域名；"
            "读写仍用内网 OBJECT_ENDPOINT，预签名不得回退到内网地址。",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        scheme = (urlparse(presign).scheme or "").lower()
    except Exception:
        scheme = ""
    if scheme != "https":
        print(
            "[startup_security] 生产环境 OBJECT_PRESIGN_ENDPOINT 须为 https:// 开头，当前无效或明文 http。",
            file=sys.stderr,
        )
        sys.exit(1)
