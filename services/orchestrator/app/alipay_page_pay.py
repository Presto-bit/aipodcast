"""
支付宝电脑网站支付（alipay.trade.page.pay）：签名下单、异步通知验签。

配置见仓库根目录 `.env.ai-native.example`（`ALIPAY_*`）。生产须 `ALIPAY_SANDBOX=0`，且 `ALIPAY_NOTIFY_URL` 与开放平台异步通知地址、Next 路由 `/api/webhooks/alipay` 一致。
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlparse

from alipay import AliPay

_log = logging.getLogger(__name__)


def _truthy(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _default_return_url_from_notify(notify_url: str) -> str:
    """
    未配置 ALIPAY_RETURN_URL 时，用异步通知域名的 /subscription 作为同步回跳，
    与常见部署（Next：`https://域名/api/webhooks/alipay` → 站点 `https://域名/subscription`）一致。
    """
    u = (notify_url or "").strip()
    if not u:
        return ""
    try:
        p = urlparse(u)
        if p.scheme not in ("http", "https") or not p.netloc:
            return ""
        return f"{p.scheme}://{p.netloc}/subscription"
    except Exception:
        return ""


def _read_pem_from_path_or_env(path_env: str, pem_env: str) -> str:
    p = (os.getenv(path_env) or "").strip()
    if p:
        try:
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()
        except OSError as e:
            _log.warning("alipay: cannot read PEM from %s (%s): %s", path_env, p, e)
            return ""
    raw = (os.getenv(pem_env) or "").strip()
    if not raw:
        return ""
    if "\\n" in raw and "\n" not in raw:
        raw = raw.replace("\\n", "\n")
    return raw.strip()


@dataclass(frozen=True)
class AlipayPagePayConfig:
    app_id: str
    app_private_key_pem: str
    alipay_public_key_pem: str
    notify_url: str
    return_url: str
    sandbox: bool

    @classmethod
    def from_env(cls) -> AlipayPagePayConfig | None:
        try:
            if not _truthy("ALIPAY_PAY_ENABLED"):
                return None
            app_id = (os.getenv("ALIPAY_APP_ID") or "").strip()
            notify_url = (os.getenv("ALIPAY_NOTIFY_URL") or "").strip()
            return_url = (os.getenv("ALIPAY_RETURN_URL") or "").strip() or _default_return_url_from_notify(notify_url)
            priv = _read_pem_from_path_or_env("ALIPAY_APP_PRIVATE_KEY_PATH", "ALIPAY_APP_PRIVATE_KEY_PEM")
            pub = _read_pem_from_path_or_env("ALIPAY_PUBLIC_KEY_PATH", "ALIPAY_PUBLIC_KEY_PEM")
            sandbox = _truthy("ALIPAY_SANDBOX")
            if not all([app_id, notify_url, return_url, priv, pub]):
                return None
            return cls(
                app_id=app_id,
                app_private_key_pem=priv,
                alipay_public_key_pem=pub,
                notify_url=notify_url,
                return_url=return_url,
                sandbox=sandbox,
            )
        except Exception as e:
            _log.warning("alipay: from_env failed (treat as disabled): %s", e)
            return None


def alipay_page_pay_ready() -> bool:
    return AlipayPagePayConfig.from_env() is not None


def gateway_base_url(*, sandbox: bool) -> str:
    if sandbox:
        return "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
    return "https://openapi.alipay.com/gateway.do"


def new_out_trade_no() -> str:
    """商户单号：字母数字，长度适中（支付宝建议 64 内）。"""
    return "ap" + secrets.token_hex(14)


def build_alipay_client(cfg: AlipayPagePayConfig) -> AliPay:
    return AliPay(
        appid=cfg.app_id,
        app_notify_url=cfg.notify_url,
        app_private_key_string=cfg.app_private_key_pem,
        alipay_public_key_string=cfg.alipay_public_key_pem,
        sign_type="RSA2",
        debug=cfg.sandbox,
    )


def build_page_pay_url(
    cfg: AlipayPagePayConfig,
    *,
    out_trade_no: str,
    subject: str,
    total_amount_yuan_str: str,
) -> tuple[bool, str, str]:
    """
    生成电脑网站支付跳转 URL（GET gateway.do?...）。
    成功：(True, "", url)；失败：(False, reason, "")。
    """
    oid = (out_trade_no or "").strip()
    if not oid:
        return False, "missing_out_trade_no", ""
    subj = (subject or "订单支付").strip()[:256]
    amt = (total_amount_yuan_str or "").strip()
    if not amt:
        return False, "missing_total_amount", ""
    try:
        client = build_alipay_client(cfg)
        qs = client.api_alipay_trade_page_pay(
            subj,
            oid,
            amt,
            return_url=cfg.return_url,
            notify_url=cfg.notify_url,
        )
        base = gateway_base_url(sandbox=cfg.sandbox)
        return True, "", f"{base}?{qs}"
    except Exception as e:
        _log.warning("alipay page pay build failed: %s", e)
        return False, "alipay_page_pay_build_failed", ""


def verify_notify_params(cfg: AlipayPagePayConfig, params: dict[str, str], signature: str) -> bool:
    """验签（异步通知）；复制 dict，避免 alipay SDK 弹出 sign_type 时破坏原数据。"""
    if not signature.strip():
        return False
    try:
        client = build_alipay_client(cfg)
        return bool(client.verify(dict(params), signature))
    except Exception as e:
        _log.warning("alipay notify verify failed: %s", e)
        return False
