"""内网对象存储 URL 识别与 API 序列化清洗（无 boto3，供 job_serialization 等轻量导入）。"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


def is_likely_internal_object_store_http_url(url: str) -> bool:
    """浏览器无法直接访问的内网/集群对象存储 Host（与预签名公网 URL 区分）。"""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return False
    try:
        host = (urlparse(u).hostname or "").lower()
    except Exception:
        return False
    if host in ("minio", "localhost", "127.0.0.1", "::1"):
        return True
    if host.endswith(".svc.cluster.local"):
        return True
    return False


def strip_internal_object_store_http_url(url: str) -> str:
    """
    返回给浏览器/API 列表时：内网对象存储直链不可用（混合内容 / 不可解析 Host），置空；
    仍保留 result.audio_object_key 等字段供 work-listen 等路径现签公网 URL。
    """
    u = (url or "").strip()
    if not u:
        return ""
    if is_likely_internal_object_store_http_url(u):
        return ""
    return u


def sanitize_job_result_media_urls_for_browser(result: dict[str, Any]) -> None:
    """就地清除 result 中对浏览器不可用的内网存储直链（不改变库内原始 JSON，仅序列化输出）。"""
    if not isinstance(result, dict):
        return
    au = str(result.get("audio_url") or "").strip()
    if au and is_likely_internal_object_store_http_url(au):
        result["audio_url"] = ""
    for ck in ("cover_image", "coverImage"):
        if ck not in result:
            continue
        c = str(result.get(ck) or "").strip()
        if c and is_likely_internal_object_store_http_url(c):
            result[ck] = ""
