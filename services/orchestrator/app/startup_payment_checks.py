"""编排器启动期：支付相关配置自检（仅打日志，不阻断进程）。"""

from __future__ import annotations

import logging
import os

from .alipay_page_pay import AlipayPagePayConfig
from .config import settings

logger = logging.getLogger(__name__)


def _fyv_production() -> bool:
    return (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")


def run_payment_startup_checks() -> None:
    """INTERNAL_SIGNING_SECRET 与 ALIPAY_* 的弱配置告警；与 BFF 对齐见 deploy 文档。"""
    try:
        sec = (settings.internal_signing_secret or "").strip()
        if _fyv_production():
            if len(sec) < 32 or sec == "local-internal-secret":
                logger.error(
                    "[payment-startup] INTERNAL_SIGNING_SECRET 在生产环境无效或过弱（须 ≥32 字节随机串，"
                    "并与 Next BFF 一致）；否则支付宝回调 BFF→编排器签名校验失败，无法入账。"
                )
        cfg = AlipayPagePayConfig.from_env()
        if not cfg:
            return
        nu = (cfg.notify_url or "").strip()
        nu_lower = nu.lower()
        if not cfg.sandbox and nu_lower.startswith("http://"):
            logger.warning(
                "[payment-startup] ALIPAY_NOTIFY_URL 使用 http（sandbox=0 生产）；"
                "支付宝正式环境通常要求 https，否则异步通知可能无法送达。"
            )
        if "/api/webhooks/alipay" not in nu:
            logger.warning(
                "[payment-startup] ALIPAY_NOTIFY_URL 未包含 /api/webhooks/alipay；"
                "须与 Next 公网 BFF 路径一致（例如 https://域名/api/webhooks/alipay）。当前=%s",
                nu[:120] + ("…" if len(nu) > 120 else ""),
            )
    except Exception:
        logger.exception("[payment-startup] run_payment_startup_checks failed")
