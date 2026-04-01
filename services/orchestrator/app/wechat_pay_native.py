"""
微信支付 Native 扫码（APIv3）：统一下单、通知验签与 resource 解密。

配置项见仓库根目录 `.env.ai-native.example`（运行时由 `config.py` 加载 `.env.ai-native`）。
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any

_log = logging.getLogger(__name__)

import httpx
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import load_pem_private_key


def _truthy(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _orchestrator_is_production_like() -> bool:
    """与部署环境相关的保守判断：生产/预发禁止跳过微信通知验签。"""
    for key in ("FYV_ENV", "ORCHESTRATOR_ENV", "DEPLOYMENT_ENV", "APP_ENV", "ENV"):
        v = (os.getenv(key) or "").strip().lower()
        if v in ("production", "prod", "staging", "live"):
            return True
    return (os.getenv("NODE_ENV") or "").strip().lower() == "production"


def _read_pem_from_path_or_env(path_env: str, pem_env: str) -> bytes:
    p = (os.getenv(path_env) or "").strip()
    if p:
        with open(p, "rb") as f:
            return f.read()
    raw = (os.getenv(pem_env) or "").strip()
    if not raw:
        return b""
    if "\\n" in raw and "\n" not in raw:
        raw = raw.replace("\\n", "\n")
    return raw.encode("utf-8")


@dataclass(frozen=True)
class WechatPayNativeConfig:
    app_id: str
    mch_id: str
    cert_serial: str
    api_v3_key: str
    private_key_pem: bytes
    notify_url: str
    platform_cert_pem: bytes
    api_base: str
    skip_notify_verify: bool

    @classmethod
    def from_env(cls) -> WechatPayNativeConfig | None:
        if not _truthy("WECHAT_PAY_ENABLED"):
            return None
        app_id = (os.getenv("WECHAT_APP_ID") or "").strip()
        mch_id = (os.getenv("WECHAT_MCH_ID") or "").strip()
        cert_serial = (os.getenv("WECHAT_MCH_CERT_SERIAL_NO") or "").strip()
        api_v3_key = (os.getenv("WECHAT_API_V3_KEY") or "").strip()
        notify_url = (os.getenv("WECHAT_NOTIFY_URL") or "").strip()
        pem = _read_pem_from_path_or_env("WECHAT_MCH_PRIVATE_KEY_PATH", "WECHAT_MCH_PRIVATE_KEY_PEM")
        plat = _read_pem_from_path_or_env("WECHAT_PLATFORM_CERT_PATH", "WECHAT_PLATFORM_CERT_PEM")
        api_base = (os.getenv("WECHAT_PAY_API_BASE") or "https://api.mch.weixin.qq.com").rstrip("/")
        skip = _truthy("WECHAT_NOTIFY_SKIP_VERIFY")
        if skip and _orchestrator_is_production_like():
            _log.error(
                "WECHAT_NOTIFY_SKIP_VERIFY is forbidden in production-like env; forcing signature verification. "
                "Configure WECHAT_PLATFORM_CERT_PATH or WECHAT_PLATFORM_CERT_PEM."
            )
            skip = False
        if not all([app_id, mch_id, cert_serial, api_v3_key, notify_url, pem]):
            return None
        if len(api_v3_key) != 32:
            return None
        if not skip and not plat:
            return None
        return cls(
            app_id=app_id,
            mch_id=mch_id,
            cert_serial=cert_serial,
            api_v3_key=api_v3_key,
            private_key_pem=pem,
            notify_url=notify_url,
            platform_cert_pem=plat,
            api_base=api_base,
            skip_notify_verify=skip,
        )


def wechat_native_ready() -> bool:
    return WechatPayNativeConfig.from_env() is not None


def _load_merchant_private_key(pem: bytes):
    return load_pem_private_key(pem, password=None)


def _sign_authorization(
    *,
    mch_id: str,
    cert_serial: str,
    method: str,
    url_path: str,
    body: str,
    private_key_pem: bytes,
) -> str:
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    message = f"{method.upper()}\n{url_path}\n{ts}\n{nonce}\n{body}\n"
    pk = _load_merchant_private_key(private_key_pem)
    sig = pk.sign(message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    sig_b64 = base64.b64encode(sig).decode("ascii")
    token = (
        f'WECHATPAY2-SHA256-RSA2048 mchid="{mch_id}",'
        f'nonce_str="{nonce}",timestamp="{ts}",serial_no="{cert_serial}",signature="{sig_b64}"'
    )
    return token


def create_native_order(
    cfg: WechatPayNativeConfig,
    *,
    out_trade_no: str,
    description: str,
    amount_total_cents: int,
) -> tuple[bool, str, dict[str, Any]]:
    """
    调用 `/v3/pay/transactions/native`。
    成功返回 (True, "", {"code_url": ...})；失败 (False, error_message, {})。
    """
    path = "/v3/pay/transactions/native"
    url = f"{cfg.api_base}{path}"
    body_obj = {
        "appid": cfg.app_id,
        "mchid": cfg.mch_id,
        "description": (description or "订单支付")[:120],
        "out_trade_no": out_trade_no,
        "notify_url": cfg.notify_url,
        "amount": {"total": int(amount_total_cents), "currency": "CNY"},
    }
    body_str = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False)
    auth = _sign_authorization(
        mch_id=cfg.mch_id,
        cert_serial=cfg.cert_serial,
        method="POST",
        url_path=path,
        body=body_str,
        private_key_pem=cfg.private_key_pem,
    )
    headers = {
        "Authorization": auth,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "aipodcast-orchestrator-wechat-native",
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, content=body_str.encode("utf-8"), headers=headers)
    except Exception as e:
        return False, f"wechat_http_error:{e}", {}
    try:
        data = r.json()
    except Exception:
        return False, f"wechat_bad_json_http_{r.status_code}", {}
    if r.status_code >= 400:
        msg = str(data.get("message") or data.get("detail") or r.text)[:300]
        return False, msg, {}
    code_url = str(data.get("code_url") or "").strip()
    if not code_url:
        return False, "missing_code_url", {}
    return True, "", {"code_url": code_url, "raw": data}


def verify_notify_signature(
    cfg: WechatPayNativeConfig,
    *,
    timestamp: str,
    nonce: str,
    body_text: str,
    signature_b64: str,
) -> bool:
    if cfg.skip_notify_verify:
        return True
    message = f"{timestamp}\n{nonce}\n{body_text}\n"
    try:
        sig = base64.b64decode(signature_b64)
        cert = x509.load_pem_x509_certificate(cfg.platform_cert_pem, default_backend())
        pub = cert.public_key()
        pub.verify(sig, message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception:
        return False


def decrypt_notify_resource(cfg: WechatPayNativeConfig, resource: dict[str, Any]) -> dict[str, Any]:
    """解密通知中的 resource.ciphertext（AEAD_AES_256_GCM）。"""
    key = cfg.api_v3_key.encode("utf-8")
    if len(key) != 32:
        raise ValueError("invalid_api_v3_key_length")
    nonce = str(resource.get("nonce") or "").encode("utf-8")
    ad = str(resource.get("associated_data") or "").encode("utf-8")
    ct_b64 = str(resource.get("ciphertext") or "")
    ct = base64.b64decode(ct_b64)
    aes = AESGCM(key)
    plain = aes.decrypt(nonce, ct, ad)
    return json.loads(plain.decode("utf-8"))


def new_out_trade_no() -> str:
    """商户单号：仅字母数字，长度 <= 32，与微信约束一致。"""
    # wx + 24 hex = 26
    return "wx" + secrets.token_hex(12)
