"""
支付宝电脑网站支付（alipay.trade.page.pay）：签名下单、异步通知验签。

配置见仓库根目录 `.env.ai-native.example`（`ALIPAY_*`）。生产须 `ALIPAY_SANDBOX=0`，且 `ALIPAY_NOTIFY_URL` 与开放平台异步通知地址、Next 路由 `/api/webhooks/alipay` 一致。

网关报 invalid-signature：多为 **ALIPAY_APP_PRIVATE_KEY** 与开放平台「接口加签方式」里上传的 **应用公钥** 不是同一 RSA 密钥对，或 PEM 含 BOM/多余字符。ALIPAY_PUBLIC_KEY_* 须填 **支付宝公钥**（验回调），与上述应用公钥不同。
"""

from __future__ import annotations

import base64
import logging
import os
import secrets
from typing import Any
from dataclasses import dataclass
from urllib.parse import urlparse

from alipay import AliPay
from Cryptodome.PublicKey import RSA

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


def _normalize_pem(text: str) -> str:
    """去掉 BOM、统一换行、去掉首尾 markdown 代码围栏，降低验签失败概率。"""
    s = (text or "").strip().replace("\ufeff", "")
    s = s.replace("\r\n", "\n").replace("\r", "\n").strip()
    lines = s.split("\n")
    while lines and lines[0].strip().startswith("```"):
        lines.pop(0)
    while lines and lines[-1].strip() == "```":
        lines.pop()
    return "\n".join(ln.rstrip() for ln in lines).strip()


def _import_rsa(data: bytes | str) -> Any:
    """兼容 PyCryptodome 的 import_key / importKey。"""
    if isinstance(data, str):
        data_b = data.encode("utf-8")
    else:
        data_b = data
    try:
        return RSA.import_key(data_b)  # type: ignore[return-value]
    except AttributeError:
        return RSA.importKey(data_b)  # type: ignore[attr-defined,no-any-return]


def _coerce_rsa_to_pem(text: str, *, private: bool) -> str:
    """
    支付宝密钥工具常导出「无 PEM 头尾」的纯 Base64；补成标准 PEM 供 python-alipay-sdk 加载。
    若已是 -----BEGIN ...----- 则仅做规范化后原样返回（解析失败也原样返回）。
    """
    s = _normalize_pem(text)
    if not s:
        return s
    if "-----BEGIN" in s:
        try:
            k = _import_rsa(s)
            return k.export_key().decode() if private else k.publickey().export_key().decode()
        except (ValueError, TypeError, IndexError, OSError):
            return s
    compact = "".join(s.split())
    if len(compact) < 64:
        return s
    try:
        der = base64.b64decode(compact)
        k = _import_rsa(der)
        return k.export_key().decode() if private else k.publickey().export_key().decode()
    except (ValueError, TypeError, IndexError, OSError) as e:
        _log.debug("alipay: coerce base64 to PEM skipped: %s", e)
        return s


def _read_pem_from_path_or_env(path_env: str, pem_env: str, *, private: bool) -> str:
    p = (os.getenv(path_env) or "").strip()
    raw = ""
    if p:
        try:
            with open(p, "r", encoding="utf-8") as f:
                raw = f.read()
        except OSError as e:
            _log.warning("alipay: cannot read PEM from %s (%s): %s", path_env, p, e)
            return ""
    else:
        raw = (os.getenv(pem_env) or "").strip()
        if not raw:
            return ""
        if "\\n" in raw and "\n" not in raw:
            raw = raw.replace("\\n", "\n")
    return _coerce_rsa_to_pem(raw, private=private)


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
            priv = _read_pem_from_path_or_env(
                "ALIPAY_APP_PRIVATE_KEY_PATH",
                "ALIPAY_APP_PRIVATE_KEY_PEM",
                private=True,
            )
            pub = _read_pem_from_path_or_env(
                "ALIPAY_PUBLIC_KEY_PATH",
                "ALIPAY_PUBLIC_KEY_PEM",
                private=False,
            )
            sandbox = _truthy("ALIPAY_SANDBOX")
            if (
                notify_url
                and not sandbox
                and notify_url.lower().startswith("http://")
            ):
                _log.warning(
                    "alipay: ALIPAY_NOTIFY_URL must use https in production (sandbox=0); treating as disabled"
                )
                return None
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
